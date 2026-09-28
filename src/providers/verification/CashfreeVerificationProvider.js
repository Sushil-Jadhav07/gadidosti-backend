const VerificationProvider = require('./VerificationProvider');

// Cashfree's Verification Suite (VRS) — needs CASHFREE_VERIFICATION_CLIENT_ID +
// CASHFREE_VERIFICATION_CLIENT_SECRET in .env (see .env.example). These are separate keys from
// any Cashfree *payment gateway* credentials — the Verification Suite is a distinct product with
// its own API keys, generated from Merchant Dashboard → Verification Suite → API Keys.
//
// Base URL / endpoint paths / request+response field names below are taken directly from
// Cashfree's own Node.js SDK source (cashfree/cashfree-verification-sdk-nodejs, api.ts) — the
// PANApi, DrivingLicenseApi and AadhaarApi classes — not guessed.
const BASE_URL = process.env.CASHFREE_VERIFICATION_ENV === 'production'
  ? 'https://api.cashfree.com/verification'
  : 'https://sandbox.cashfree.com/verification';

class CashfreeVerificationProvider extends VerificationProvider {
  constructor() {
    super();
    this.clientId = process.env.CASHFREE_VERIFICATION_CLIENT_ID;
    this.clientSecret = process.env.CASHFREE_VERIFICATION_CLIENT_SECRET;
  }

  get headers() {
    return {
      'Content-Type': 'application/json',
      'x-client-id': this.clientId,
      'x-client-secret': this.clientSecret,
    };
  }

  // Shared request helper. A real outage (5xx) or bad credentials / un-whitelisted IP (401/403)
  // is thrown with a "Cashfree verification unavailable:" prefix, which kyc.controller.js's
  // verificationErrorMessage masks behind a generic message (these can include our own server's
  // IP etc. — not for an end-user's screen). BUT Cashfree also signals an ordinary per-attempt
  // failure through an error status — confirmed: the driving-license endpoint answers a
  // non-test DL number in sandbox with HTTP 502 and { code: "verification_failed", message:
  // "Please use test data in the test environment..." }, not a 200 like PAN/Aadhaar. That carries
  // a specific, safe, useful message and isn't an outage, so it must not be masked just because
  // of its status code. `code === 'verification_failed'` (with a message that doesn't name our
  // own infra) is what marks that case; it's returned as a normal body instead of thrown, and
  // each verify* method turns it into a 'failed' result carrying that message. Every other 2xx/
  // 4xx is never thrown either — "this PAN doesn't exist" is an expected outcome, not an
  // exceptional failure.
  async request(path, body) {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    const namesInfra = !data.message || /\bip\b|client.?id|client.?secret|whitelist/i.test(data.message);
    const isPerAttemptFailure = data.code === 'verification_failed' && !namesInfra;
    if (!isPerAttemptFailure && (res.status >= 500 || ((res.status === 401 || res.status === 403) && namesInfra))) {
      throw new Error(`Cashfree verification unavailable: ${data.message || res.statusText}`);
    }
    return { httpStatus: res.status, body: data };
  }

  async verifyPan({ pan, name }) {
    const { body } = await this.request('/pan', { pan, ...(name ? { name } : {}) });
    // 'valid' is the direct success indicator Cashfree returns for this endpoint (see
    // GetVerifyPanResponseSchema in their SDK) — true/false regardless of HTTP status.
    const verified = body.valid === true;
    return {
      status: verified ? 'verified' : 'failed',
      details: {
        pan: body.pan,
        registeredName: body.registered_name || null,
        nameMatch: body.name_match_result || null,
        nameMatchScore: body.name_match_score || null,
        message: body.message || null,
      },
      raw: body,
    };
  }

  async verifyDrivingLicense({ dlNumber, dob }) {
    // verification_id is Cashfree's own idempotency key for this call, not something we need to
    // look up later — a fresh one per call avoids a "verification id already exists" 409 on retry.
    const verificationId = `dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const { body } = await this.request('/driving-license', { verification_id: verificationId, dl_number: dlNumber, dob });
    // Cashfree's own examples show a truthy `status` string (e.g. "id_found") on a genuine
    // match; anything falsy/absent (or an explicit error message with no details) means no
    // match was found for that DL number + DOB combination.
    const verified = !!body.status && !!body.details_of_driving_licence;
    return {
      status: verified ? 'verified' : 'failed',
      details: {
        dlNumber: body.dl_number,
        dob: body.dob,
        holderName: body.details_of_driving_licence?.name || null,
        status: body.status || null,
        message: body.message || null,
      },
      raw: body,
    };
  }

  async sendAadhaarOtp(aadhaarNumber) {
    const { body } = await this.request('/offline-aadhaar/otp', { aadhaar_number: aadhaarNumber });
    if (!body.ref_id) {
      const message = body.message || 'Failed to send Aadhaar OTP';
      const err = new Error(message);
      // Cashfree rate-limits repeat requests for the same Aadhaar within a cooldown window and,
      // in THAT specific case, doesn't hand back a ref_id — even though the OTP it sent earlier
      // is still valid, which is what the cached-ref_id fallback below exists for. Every other
      // missing-ref_id reason (e.g. "Offline Aadhaar Verification is not enabled for this
      // account" — a real account-configuration problem, not a transient cooldown) is NOT that,
      // and must never be mistaken for it — that account-level failure will never resolve itself
      // by waiting, so showing "an OTP was already sent, try again shortly" would be actively
      // misleading. Match on the specific cooldown wording, not just "no ref_id at all".
      if (/already generated|try after some time/i.test(message)) {
        err.cashfreeNoRefId = true;
      }
      throw err;
    }
    return { refId: body.ref_id, status: body.status || 'otp_sent' };
  }

  // DigiLocker (POST /digilocker, GET /digilocker, GET /digilocker/document/{type}) — one consent
  // session can cover Aadhaar + PAN + Driving License. This is the flow that's enabled on accounts
  // where Offline Aadhaar OTP isn't. The link is valid ~10 minutes; Cashfree redirects the user to
  // redirectUrl (appending verification_id) once they finish or abandon the DigiLocker journey.
  async createDigilockerLink({ verificationId, redirectUrl, documents = ['AADHAAR'] }) {
    const { body } = await this.request('/digilocker', {
      verification_id: verificationId,
      document_requested: documents,
      redirect_url: redirectUrl,
      user_flow: 'signup',
    });
    if (!body.url) {
      throw new Error(body.message || 'Failed to create the DigiLocker link');
    }
    return { url: body.url, status: body.status || 'PENDING' };
  }

  // Resolves a DigiLocker session into one result per requested document:
  //   verified — the document was fetched from DigiLocker after the user authenticated there
  //              (a government-issued record DigiLocker itself vouches for)
  //   missing  — the user has no such document in their DigiLocker (or didn't allow it); the caller
  //              can fall back to verifying that one by number instead
  // Overall: 'pending' (user still in DigiLocker / Cashfree still processing — poll again),
  // 'failed' (session expired or consent denied, nothing to store), or 'done'.
  async getDigilockerStatus(verificationId, documents = ['AADHAAR']) {
    const call = async (path) => {
      const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers: this.headers });
      const body = await res.json().catch(() => ({}));
      if (res.status >= 500 || res.status === 401 || res.status === 403) {
        throw new Error(`Cashfree verification unavailable: ${body.message || res.statusText}`);
      }
      return { httpStatus: res.status, body };
    };

    const session = await call(`/digilocker?verification_id=${encodeURIComponent(verificationId)}`);
    const sessionStatus = String(session.body.status || '').toUpperCase();
    if (!sessionStatus || sessionStatus === 'PENDING') return { status: 'pending', documents: {} };
    if (sessionStatus !== 'AUTHENTICATED') {
      return {
        status: 'failed',
        documents: {},
        message: sessionStatus === 'CONSENT_DENIED'
          ? 'Access was not allowed in DigiLocker — start again and allow access when asked.'
          : 'The DigiLocker session expired — please start again.',
      };
    }

    const out = {};
    for (const type of documents) {
      const doc = await call(`/digilocker/document/${type}?verification_id=${encodeURIComponent(verificationId)}`);
      if (doc.httpStatus === 202) return { status: 'pending', documents: {} };
      if (doc.httpStatus === 200 && doc.body && Object.keys(doc.body).length > 0) {
        out[type] = { status: 'verified', details: this.summarizeDigilockerDocument(type, doc.body) };
      } else {
        out[type] = { status: 'missing', details: { message: doc.body.message || 'Not found in your DigiLocker' } };
      }
    }
    return { status: 'done', documents: out };
  }

  // Deliberately keeps only what a reviewer needs (name, DOB, gender, the document's own number as
  // returned) — NOT the full document payload, which for Aadhaar carries the address, a photo, etc.
  // that we have no reason to store. Field names for PAN / licence are matched defensively across
  // the spellings Cashfree's document payloads use.
  summarizeDigilockerDocument(type, body) {
    const pick = (...keys) => keys.map((k) => body[k]).find((v) => typeof v === 'string' && v) || null;
    return {
      name: pick('name', 'holder_name', 'full_name') || body.details_of_driving_licence?.name || null,
      dob: pick('dob', 'date_of_birth'),
      gender: pick('gender'),
      number: type === 'PAN' ? pick('pan', 'pan_number', 'uid')
        : type === 'DRIVING_LICENSE' ? pick('dl_number', 'license_number', 'uid')
        : pick('uid', 'aadhaar_number'),
      message: null,
    };
  }

  async verifyAadhaarOtp({ refId, otp }) {
    const { body } = await this.request('/offline-aadhaar/verify', { ref_id: refId, otp });
    // Per Cashfree's own documented response codes for this endpoint: 200/SUCCESS with message
    // "Aadhaar Card Exists" is the pass case; every documented failure (expired session, wrong
    // OTP, invalid Aadhaar, etc.) comes back as an ERROR status with no name/address fields.
    const verified = String(body.status).toUpperCase() === 'SUCCESS' && !!body.name;
    return {
      status: verified ? 'verified' : 'failed',
      details: {
        name: body.name || null,
        dob: body.dob || null,
        gender: body.gender || null,
        address: body.address || null,
        message: body.message || null,
      },
      raw: body,
    };
  }
}

module.exports = CashfreeVerificationProvider;
