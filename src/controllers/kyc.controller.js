const pool = require('../config/db');
const KycModel = require('../models/kyc.model');
const UserModel = require('../models/user.model');
const DriverProfileModel = require('../models/driverProfile.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getStorageProvider } = require('../providers/storage');
const { getFileUrl, toAbsoluteUrl } = require('../utils/fileUrl');
const { getVerificationProvider } = require('../providers/verification');

const storageProvider = getStorageProvider();
const verificationProvider = getVerificationProvider();

// A submission auto-clears straight to 'verified' the moment every check Cashfree can run for
// this role has already come back 'verified' (via the /kyc/verify/* endpoints, called from the
// onboarding wizard before this final submit). Anything short of that — a check that failed,
// was skipped, or errored — falls back to the old 'submitted' queue, where the admin/broker
// manual-review screens (still present, just no longer the default path) pick it up.
const REQUIRED_CHECKS_BY_ROLE = {
  driver: ['pan', 'aadhaar', 'drivingLicense'],
  broker: ['pan', 'aadhaar'],
};

// ─── POST /api/kyc/broker, POST /api/kyc/driver ─────────────────────────────────
// Shared handler — role-specific required fields are enforced by validation
// middleware on each route (kyc.validation.js), not here.
const submitKyc = async (req, res, next) => {
  try {
    const { documents } = req.body;

    let submission = await KycModel.upsertSubmission(req.user.id, documents);

    const requiredChecks = REQUIRED_CHECKS_BY_ROLE[req.user.role] || [];
    const results = submission.verification_results || {};
    const autoVerified = requiredChecks.length > 0 && requiredChecks.every((key) => results[key]?.status === 'verified');

    let kycStatus = 'submitted';
    if (autoVerified) {
      submission = await KycModel.autoVerify(req.user.id);
      kycStatus = 'verified';
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: autoVerified ? 'KYC_AUTO_VERIFIED' : 'KYC_SUBMITTED',
      entity: 'kyc_submissions',
      entityId: submission.id,
      meta: { document_keys: Object.keys(documents), auto_verified: autoVerified },
      ipAddress: req.ip,
    });

    if (autoVerified) {
      await NotificationModel.create({
        userId: req.user.id,
        title: 'KYC Verified',
        message: 'Your documents were verified automatically. You now have full access to the platform.',
        type: 'kyc',
      });
    }

    logger.info(`KYC submitted: ${req.user.id} [${req.user.role}]${autoVerified ? ' — auto-verified' : ''}`);
    return successResponse(
      res, 200,
      autoVerified ? 'KYC verified automatically' : 'KYC documents submitted for review',
      { submission, kyc_status: kycStatus }
    );
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/kyc/documents/upload ──────────────────────────────────────────────
// Uploads a document file via the active StorageProvider and merges the returned
// URL into the user's kyc_submissions.documents under `document_key`. Requires a
// multipart request — see upload.middleware.js (multer, memory storage) on the route.
const uploadKycDocument = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 422, 'No file uploaded — attach it as multipart form field "file"');

    const { document_key } = req.body;
    if (!document_key) return errorResponse(res, 422, 'document_key is required (e.g. "pan_card_photo")');

    const { url } = await storageProvider.upload({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      documentKey: document_key,
      folder: `kyc/${req.user.id}`,
    });
    // Store the absolute url, not the provider's raw relative path — otherwise a client
    // reading it back later (e.g. after a refresh, before API_BASE_URL existed) would
    // resolve it against its own origin instead of the API's.
    const absoluteUrl = toAbsoluteUrl(req, url);

    const existing = await KycModel.findByUserId(req.user.id);
    const documents = { ...(existing?.documents || {}), [document_key]: absoluteUrl };
    const submission = await KycModel.upsertSubmission(req.user.id, documents);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_DOCUMENT_UPLOADED',
      entity: 'kyc_submissions',
      entityId: submission.id,
      meta: { document_key },
      ipAddress: req.ip,
    });

    // Postgres-backed uploads return /api/kyc/documents/file/<id> — pull the id back out
    // for the response. Other providers (e.g. local disk) already return a servable path.
    const fileId = url.startsWith('/api/kyc/documents/file/') ? url.split('/').pop() : null;

    // Re-uploading the same document_key replaces it — drop the old kyc_files row so
    // it doesn't sit around as an orphan.
    if (fileId) await KycModel.deleteOtherFiles(req.user.id, document_key, fileId);

    logger.info(`KYC document uploaded: ${req.user.id} [${document_key}]`);
    return successResponse(res, 200, 'Document uploaded', {
      document: {
        id: fileId,
        user_id: req.user.id,
        document_type: document_key,
        url: toAbsoluteUrl(req, url),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/documents ───────────────────────────────────────────────────────
// Lists the caller's own uploaded documents, one object per document_type (not merged
// into a single blob like kyc_submissions.documents), each with a ready-to-use absolute url.
const listMyKycDocuments = async (req, res, next) => {
  try {
    const files = await KycModel.listFiles(req.user.id);
    const documents = files.map((f) => ({
      id: f.id,
      document_type: f.document_type,
      path: `kyc/${f.user_id}/${f.document_type}/${f.filename}`,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: Number(f.size_bytes),
      uploaded_at: f.created_at,
      url: getFileUrl(req, f.id),
    }));
    return successResponse(res, 200, 'KYC documents fetched', { documents });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/kyc/:userId/documents ────────────────────────────────────────
const listUserKycDocuments = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) return errorResponse(res, 404, 'User not found');

    const files = await KycModel.listFiles(userId);
    const documents = files.map((f) => ({
      id: f.id,
      document_type: f.document_type,
      path: `kyc/${f.user_id}/${f.document_type}/${f.filename}`,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: Number(f.size_bytes),
      uploaded_at: f.created_at,
      url: getFileUrl(req, f.id),
    }));
    return successResponse(res, 200, 'KYC documents fetched', { documents });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/documents/file/:id ─────────────────────────────────────────────
// Serves a file uploaded when STORAGE_PROVIDER=postgres (kyc_files.data). Only the
// owning user or an admin may fetch it — these are PAN/Aadhaar/license photos.
const getKycFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT user_id, filename, mime_type, data FROM kyc_files WHERE id = $1`,
      [id]
    );
    const file = rows[0];
    if (!file) return errorResponse(res, 404, 'File not found');

    // 'staff' only reaches here once requireAdminPage has confirmed 'kyc' page access — same
    // full-visibility treatment as admin at that point.
    if (!['admin', 'staff'].includes(req.user.role) && req.user.id !== file.user_id) {
      // A broker may fetch documents for a driver in their own fleet (broker_id match) —
      // same ownership rule as brokerVerifyKyc/brokerRejectKyc below.
      let allowed = false;
      if (req.user.role === 'broker') {
        const profile = await DriverProfileModel.findById(file.user_id);
        allowed = !!profile && profile.broker_id === req.user.id;
      }
      if (!allowed) return errorResponse(res, 403, 'Not your document');
    }

    res.set('Content-Type', file.mime_type);
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    return res.send(file.data);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/status ──────────────────────────────────────────────────────────
const getMyKyc = async (req, res, next) => {
  try {
    const submission = await KycModel.findByUserId(req.user.id);
    return successResponse(res, 200, 'KYC status fetched', {
      kyc_status: req.user.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/:userId ─────────────────────────────────────────────────────────
// Self-only counterpart to GET /api/admin/kyc/:userId — a broker/driver may only fetch
// their own KYC this way (404 for anyone else's id, so it doesn't leak who has an account).
const getKycById = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.id) return errorResponse(res, 404, 'User not found');

    const submission = await KycModel.findByUserId(userId);
    return successResponse(res, 200, 'KYC status fetched', {
      kyc_status: req.user.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/kyc/:userId ─────────────────────────────────────────────────
const getUserKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) return errorResponse(res, 404, 'User not found');

    const submission = await KycModel.findByUserId(userId);
    return successResponse(res, 200, 'KYC submission fetched', {
      kyc_status: targetUser.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/kyc/pending ──────────────────────────────────────────────────
const getAllKyc = async (req, res, next) => {
  try {
    const { kyc_status, role, search, page = 1, limit = 10 } = req.query;

    const result = await KycModel.findAll({
      kycStatus: kyc_status, // model defaults to 'submitted' (the review queue) when omitted
      role,
      search,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'KYC submissions fetched', result);
  } catch (err) {
    next(err);
  }
};

const assertReviewable = async (userId) => {
  const targetUser = await UserModel.findById(userId);
  if (!targetUser) return { error: [404, 'User not found'] };
  if (!['broker', 'driver'].includes(targetUser.role)) {
    return { error: [400, 'KYC review only applies to broker/driver accounts'] };
  }
  if (targetUser.kyc_status === 'verified') {
    return { error: [400, 'KYC is already verified'] };
  }
  return { targetUser };
};

// Same eligibility rule as assertReviewable, scoped to a broker's own fleet: brokers may only
// review a driver (never another broker) whose driver_profiles.broker_id is them — i.e. a driver
// they assigned to themselves or created, matching how ownership is checked everywhere else in
// the broker app (e.g. assignDriver).
const assertBrokerReviewable = async (driverId, brokerId) => {
  const targetUser = await UserModel.findById(driverId);
  if (!targetUser) return { error: [404, 'User not found'] };
  if (targetUser.role !== 'driver') {
    return { error: [400, 'Brokers may only review driver KYC'] };
  }
  const profile = await DriverProfileModel.findById(driverId);
  if (!profile || profile.broker_id !== brokerId) {
    return { error: [404, 'Driver not found in your fleet'] };
  }
  if (targetUser.kyc_status === 'verified') {
    return { error: [400, 'KYC is already verified'] };
  }
  return { targetUser };
};

// ─── PATCH /api/admin/kyc/:userId/verify ────────────────────────────────────────
const verifyKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const { error } = await assertReviewable(userId);
    if (error) return errorResponse(res, ...error);

    const submission = await KycModel.review(userId, { status: 'verified', reviewerId: req.user.id });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_VERIFIED',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: userId },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId,
      title: 'KYC Verified',
      message: 'Your KYC documents have been verified. You now have full access to the platform.',
      type: 'kyc',
    });

    logger.info(`KYC verified for ${userId} by admin ${req.user.id}`);
    return successResponse(res, 200, 'KYC verified', { submission, kyc_status: 'verified' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/admin/kyc/:userId/reject ────────────────────────────────────────
const rejectKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const { error } = await assertReviewable(userId);
    if (error) return errorResponse(res, ...error);

    const submission = await KycModel.review(userId, { status: 'rejected', reviewerId: req.user.id, reason });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_REJECTED',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: userId, reason },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId,
      title: 'KYC Rejected',
      message: `Your KYC submission was rejected: ${reason}. Please review and resubmit your documents.`,
      type: 'kyc',
      meta: { reason },
    });

    logger.info(`KYC rejected for ${userId} by admin ${req.user.id}`);
    return successResponse(res, 200, 'KYC rejected', { submission, kyc_status: 'rejected' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/broker/kyc/:driverId ──────────────────────────────────────────────
// Broker's own-fleet counterpart to GET /api/admin/kyc/:userId.
const getDriverKycForBroker = async (req, res, next) => {
  try {
    const { driverId } = req.params;

    const profile = await DriverProfileModel.findById(driverId);
    if (!profile || profile.broker_id !== req.user.id) {
      return errorResponse(res, 404, 'Driver not found in your fleet');
    }

    const targetUser = await UserModel.findById(driverId);
    const submission = await KycModel.findByUserId(driverId);
    return successResponse(res, 200, 'KYC submission fetched', {
      kyc_status: targetUser.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/broker/kyc/:driverId/documents ─────────────────────────────────────
const listDriverKycDocumentsForBroker = async (req, res, next) => {
  try {
    const { driverId } = req.params;

    const profile = await DriverProfileModel.findById(driverId);
    if (!profile || profile.broker_id !== req.user.id) {
      return errorResponse(res, 404, 'Driver not found in your fleet');
    }

    const files = await KycModel.listFiles(driverId);
    const documents = files.map((f) => ({
      id: f.id,
      document_type: f.document_type,
      path: `kyc/${f.user_id}/${f.document_type}/${f.filename}`,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: Number(f.size_bytes),
      uploaded_at: f.created_at,
      url: getFileUrl(req, f.id),
    }));
    return successResponse(res, 200, 'KYC documents fetched', { documents });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/broker/kyc/:driverId/verify ──────────────────────────────────────
const brokerVerifyKyc = async (req, res, next) => {
  try {
    const { driverId } = req.params;

    const { error } = await assertBrokerReviewable(driverId, req.user.id);
    if (error) return errorResponse(res, ...error);

    const submission = await KycModel.review(driverId, { status: 'verified', reviewerId: req.user.id });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_VERIFIED_BY_BROKER',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: driverId },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: driverId,
      title: 'KYC Verified',
      message: 'Your KYC documents have been verified by your broker. You now have full access to the platform.',
      type: 'kyc',
    });

    logger.info(`KYC verified for driver ${driverId} by broker ${req.user.id}`);
    return successResponse(res, 200, 'KYC verified', { submission, kyc_status: 'verified' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/broker/kyc/:driverId/reject ──────────────────────────────────────
const brokerRejectKyc = async (req, res, next) => {
  try {
    const { driverId } = req.params;
    const { reason } = req.body;

    const { error } = await assertBrokerReviewable(driverId, req.user.id);
    if (error) return errorResponse(res, ...error);

    const submission = await KycModel.review(driverId, { status: 'rejected', reviewerId: req.user.id, reason });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_REJECTED_BY_BROKER',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: driverId, reason },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: driverId,
      title: 'KYC Rejected',
      message: `Your KYC submission was rejected by your broker: ${reason}. Please review and resubmit your documents.`,
      type: 'kyc',
      meta: { reason },
    });

    logger.info(`KYC rejected for driver ${driverId} by broker ${req.user.id}`);
    return successResponse(res, 200, 'KYC rejected', { submission, kyc_status: 'rejected' });
  } catch (err) {
    next(err);
  }
};

// ─── Automated verification (Cashfree, or the fake provider — see src/providers/verification) ──
// Deliberately assistive, not a gate: a driver/broker can call these the moment they've typed a
// field, before ever hitting the final Submit — the result is stored immediately either way, so
// it survives even if they never submit that session. Nothing here auto-approves/auto-rejects
// KYC; the admin/broker reviewer sees the result alongside the documents and still makes that
// call themselves (see KycModel.updateVerificationResult's own reasoning).

// The 4 endpoints below deliberately don't call next(err) on a provider failure — the global
// error handler masks err.message down to a bare "Internal server error" in production (by
// design, for errors it can't classify), which left a real, actionable reason (a rate limit, a
// transient Cashfree outage, a Cashfree account not having a product enabled) looking like an
// unexplained crash. These are expected, recoverable failures of a third-party call, not bugs.
const VERIFICATION_UNAVAILABLE_MESSAGE = 'Verification service is temporarily unavailable — please try again in a few minutes.';

// CashfreeVerificationProvider's request() prefixes exactly this way for 401/403/5xx responses
// (bad credentials, IP not whitelisted, Cashfree's own outage) — infra/account-config failures
// that can include details (like this server's own IP) not meant for an end-user's screen, so
// those stay masked behind the generic message above. Everything else thrown by the provider is
// a normal 200-status response Cashfree gave about THIS specific verification attempt (wrong
// test data, OTP already sent, a product not enabled on the account, an invalid OTP) — genuinely
// useful to the person looking at it, so it's shown as-is instead of being masked too.
const isInfraFailure = (message) => typeof message === 'string' && message.startsWith('Cashfree verification unavailable:');
const verificationErrorMessage = (err) => (isInfraFailure(err.message) ? VERIFICATION_UNAVAILABLE_MESSAGE : (err.message || VERIFICATION_UNAVAILABLE_MESSAGE));

// ─── POST /api/kyc/verify/pan ──────────────────────────────────────────────────
const verifyPan = async (req, res, next) => {
  try {
    const { pan, name } = req.body;
    if (!pan) return errorResponse(res, 422, 'pan is required');

    const result = await verificationProvider.verifyPan({ pan, name });
    await KycModel.updateVerificationResult(req.user.id, 'pan', result);

    await AuditLogModel.log({
      userId: req.user.id, action: 'KYC_PAN_VERIFICATION_ATTEMPTED', entity: 'kyc_submissions',
      entityId: req.user.id, meta: { status: result.status }, ipAddress: req.ip,
    });

    logger.info(`PAN verification for ${req.user.id}: ${result.status}`);
    return successResponse(res, 200, result.status === 'verified' ? 'PAN verified' : 'PAN verification did not pass', result);
  } catch (err) {
    logger.error(`PAN verification failed for ${req.user.id}: ${err.message}`, err);
    return errorResponse(res, 503, verificationErrorMessage(err));
  }
};

// ─── POST /api/kyc/verify/driving-license ──────────────────────────────────────
const verifyDrivingLicense = async (req, res, next) => {
  try {
    const { dl_number, dob } = req.body;
    if (!dl_number || !dob) return errorResponse(res, 422, 'dl_number and dob are both required');

    const result = await verificationProvider.verifyDrivingLicense({ dlNumber: dl_number, dob });
    await KycModel.updateVerificationResult(req.user.id, 'drivingLicense', result);

    await AuditLogModel.log({
      userId: req.user.id, action: 'KYC_DL_VERIFICATION_ATTEMPTED', entity: 'kyc_submissions',
      entityId: req.user.id, meta: { status: result.status }, ipAddress: req.ip,
    });

    logger.info(`Driving license verification for ${req.user.id}: ${result.status}`);
    return successResponse(res, 200, result.status === 'verified' ? 'Driving license verified' : 'Driving license verification did not pass', result);
  } catch (err) {
    logger.error(`DL verification failed for ${req.user.id}: ${err.message}`, err);
    return errorResponse(res, 503, verificationErrorMessage(err));
  }
};

// ─── POST /api/kyc/verify/aadhaar/send-otp ─────────────────────────────────────
// Aadhaar can't be verified in one call like PAN/DL — Cashfree sends an OTP to the mobile
// number linked to the Aadhaar, which the user has to actually receive and type back in (see
// verifyAadhaarOtp below). refId here must be passed back on that second call.
const sendAadhaarOtp = async (req, res, next) => {
  try {
    const { aadhaar_number } = req.body;
    if (!aadhaar_number) return errorResponse(res, 422, 'aadhaar_number is required');

    let refId, status;
    try {
      ({ refId, status } = await verificationProvider.sendAadhaarOtp(aadhaar_number));
      await KycModel.saveAadhaarOtpRef(req.user.id, refId);
    } catch (err) {
      // Cashfree rate-limits repeat requests for the same Aadhaar within a cooldown window and
      // omits ref_id on that response — but the OTP it sent on the earlier, successful call is
      // still valid. Fall back to whatever ref_id was cached from that call instead of stranding
      // someone who already has the OTP in hand with no way to submit it.
      if (err.cashfreeNoRefId) {
        const cached = await KycModel.getRecentAadhaarOtpRef(req.user.id);
        if (cached) {
          logger.info(`Aadhaar OTP send rate-limited for ${req.user.id} — reusing cached ref_id`);
          refId = cached.ref_id;
          status = 'otp_sent';
        } else {
          throw err;
        }
      } else {
        throw err;
      }
    }

    await AuditLogModel.log({
      userId: req.user.id, action: 'KYC_AADHAAR_OTP_SENT', entity: 'kyc_submissions',
      entityId: req.user.id, ipAddress: req.ip,
    });

    logger.info(`Aadhaar OTP sent for ${req.user.id}`);
    return successResponse(res, 200, 'OTP sent to the mobile number linked to this Aadhaar', { refId, status });
  } catch (err) {
    logger.error(`Aadhaar OTP send failed for ${req.user.id}: ${err.message}`, err);
    return errorResponse(res, 503, err.cashfreeNoRefId
      ? 'An OTP was already sent recently — please wait a few minutes before requesting a new one.'
      : verificationErrorMessage(err));
  }
};

// ─── POST /api/kyc/verify/aadhaar/verify-otp ───────────────────────────────────
const verifyAadhaarOtp = async (req, res, next) => {
  try {
    const { ref_id, otp } = req.body;
    if (!ref_id || !otp) return errorResponse(res, 422, 'ref_id and otp are both required');

    const result = await verificationProvider.verifyAadhaarOtp({ refId: ref_id, otp });
    await KycModel.updateVerificationResult(req.user.id, 'aadhaar', result);

    await AuditLogModel.log({
      userId: req.user.id, action: 'KYC_AADHAAR_VERIFICATION_ATTEMPTED', entity: 'kyc_submissions',
      entityId: req.user.id, meta: { status: result.status }, ipAddress: req.ip,
    });

    logger.info(`Aadhaar verification for ${req.user.id}: ${result.status}`);
    return successResponse(res, 200, result.status === 'verified' ? 'Aadhaar verified' : 'Aadhaar verification did not pass', result);
  } catch (err) {
    logger.error(`Aadhaar verification failed for ${req.user.id}: ${err.message}`, err);
    return errorResponse(res, 503, verificationErrorMessage(err));
  }
};

module.exports = {
  submitKyc,
  uploadKycDocument,
  listMyKycDocuments,
  listUserKycDocuments,
  getKycFile,
  getKycById,
  getMyKyc,
  getUserKyc,
  getAllKyc,
  verifyKyc,
  rejectKyc,
  getDriverKycForBroker,
  listDriverKycDocumentsForBroker,
  brokerVerifyKyc,
  brokerRejectKyc,
  verifyPan,
  verifyDrivingLicense,
  sendAadhaarOtp,
  verifyAadhaarOtp,
};
