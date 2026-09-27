const VerificationProvider = require('./VerificationProvider');

// No real Cashfree credentials wired up yet (or VERIFICATION_PROVIDER=fake deliberately) —
// always "verifies" immediately, no external call. Matches FakePaymentProvider's own reasoning:
// lets the rest of the KYC flow (submission, review, the new verification UI) be built and
// tested end-to-end without needing real Cashfree keys.
class FakeVerificationProvider extends VerificationProvider {
  async verifyPan({ pan, name }) {
    return {
      status: 'verified',
      details: { pan, registeredName: name || 'Fake Registered Name', nameMatch: name ? 'matched' : null },
      raw: { provider: 'fake' },
    };
  }

  async verifyDrivingLicense({ dlNumber, dob }) {
    return {
      status: 'verified',
      details: { dlNumber, dob, holderName: 'Fake License Holder' },
      raw: { provider: 'fake' },
    };
  }

  async sendAadhaarOtp(aadhaarNumber) {
    return { refId: `FAKE-REF-${Date.now()}`, status: 'otp_sent' };
  }

  async verifyAadhaarOtp({ refId, otp }) {
    return {
      status: 'verified',
      details: { refId, name: 'Fake Aadhaar Holder', dob: '1990-01-01' },
      raw: { provider: 'fake' },
    };
  }
}

module.exports = FakeVerificationProvider;
