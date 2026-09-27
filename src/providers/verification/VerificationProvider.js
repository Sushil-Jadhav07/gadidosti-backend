/**
 * Every method returns a normalized shape regardless of provider:
 *   { status: 'verified' | 'failed', details: Object, raw: Object }
 * `details` is whatever's useful to show a reviewer (registered name, name-match result, etc.);
 * `raw` is the provider's full untouched response, kept for audit/debugging.
 *
 * @typedef {Object} VerifyPanParams
 * @property {string} pan
 * @property {string} [name] - Optional; if given, the provider also checks it against the PAN's registered name.
 *
 * @typedef {Object} VerifyDrivingLicenseParams
 * @property {string} dlNumber
 * @property {string} dob - YYYY-MM-DD.
 *
 * @typedef {Object} SendAadhaarOtpResult
 * @property {string} refId - Pass back into verifyAadhaarOtp.
 * @property {string} status
 *
 * @typedef {Object} VerifyAadhaarOtpParams
 * @property {string} refId
 * @property {string} otp
 */
class VerificationProvider {
  /** @param {VerifyPanParams} params */
  async verifyPan(params) {
    throw new Error('VerificationProvider.verifyPan not implemented');
  }

  /** @param {VerifyDrivingLicenseParams} params */
  async verifyDrivingLicense(params) {
    throw new Error('VerificationProvider.verifyDrivingLicense not implemented');
  }

  /** @param {string} aadhaarNumber @returns {Promise<SendAadhaarOtpResult>} */
  async sendAadhaarOtp(aadhaarNumber) {
    throw new Error('VerificationProvider.sendAadhaarOtp not implemented');
  }

  /** @param {VerifyAadhaarOtpParams} params */
  async verifyAadhaarOtp(params) {
    throw new Error('VerificationProvider.verifyAadhaarOtp not implemented');
  }
}

module.exports = VerificationProvider;
