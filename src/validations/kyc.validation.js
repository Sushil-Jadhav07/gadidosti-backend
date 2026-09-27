const { body } = require('express-validator');

// The only document_key values the frontend ever uploads under — must match urlField in
// SSK broker-driver/app/src/pages/broker/KYCStatus.jsx and driver/KYC.jsx exactly, since
// POST /api/kyc/documents/upload merges the file's url into kyc_submissions.documents
// under this same key.
const ALLOWED_DOCUMENT_KEYS = {
  broker: ['pan_photo_url', 'aadhaar_photo_url'],
  driver: ['license_photo_url', 'aadhaar_photo_url', 'pan_photo_url'],
};

// Canonical field names — must match exactly across KYC submission, the Profile page,
// and admin's Driver/Broker views (see broker/KYCStatus.jsx, driver/KYC.jsx, and the
// admin Drivers.jsx/KYC.jsx reconciliation in driverProfile.model.js).
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/i;
const GST_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i;
const AADHAAR_REGEX = /^\d{4}-?\d{4}-?\d{4}$/;

const submitBrokerKycValidation = [
  body('documents.pan_number').trim().notEmpty().withMessage('PAN number is required')
    .matches(PAN_REGEX).withMessage('PAN number must be in the format ABCDE1234F'),
  body('documents.aadhaar_number').trim().notEmpty().withMessage('Aadhaar number is required')
    .matches(AADHAAR_REGEX).withMessage('Aadhaar number must be 12 digits'),
  body('documents.gst_number').optional({ nullable: true, checkFalsy: true }).trim()
    .matches(GST_REGEX).withMessage('GST number must be a valid 15-character GSTIN'),
  body('documents.bank_account_number').optional({ nullable: true, checkFalsy: true }).trim()
    .isNumeric().withMessage('Bank account number must be numeric')
    .isLength({ min: 9, max: 18 }).withMessage('Bank account number must be 9-18 digits'),
  body('documents.business_registration_number').optional({ nullable: true, checkFalsy: true }).trim()
    .isLength({ min: 5, max: 30 }).withMessage('Business registration number looks invalid'),
];

const submitDriverKycValidation = [
  body('documents.license_number').trim().notEmpty().withMessage('Driving license number is required')
    .isLength({ min: 5, max: 20 }).withMessage('Driving license number looks invalid'),
  body('documents.aadhaar_number').trim().notEmpty().withMessage('Aadhaar number is required')
    .matches(AADHAAR_REGEX).withMessage('Aadhaar number must be 12 digits'),
  body('documents.vehicle_registration_number').optional({ nullable: true, checkFalsy: true }).trim()
    .isLength({ min: 4, max: 20 }).withMessage('Vehicle registration number looks invalid'),
  body('documents.vehicle_insurance_number').optional({ nullable: true, checkFalsy: true }).trim()
    .isLength({ min: 4, max: 30 }).withMessage('Vehicle insurance number looks invalid'),
  // Optional — added for Cashfree PAN verification (see kyc.controller.js's verifyPan); a
  // driver's PAN wasn't collected at all before this, unlike a broker's (see
  // submitBrokerKycValidation above), so this stays optional rather than breaking anyone who's
  // already submitted without one.
  body('documents.pan_number').optional({ nullable: true, checkFalsy: true }).trim()
    .matches(PAN_REGEX).withMessage('PAN number must be in the format ABCDE1234F'),
  // Optional — needed for Cashfree Driving License verification (see verifyDrivingLicense),
  // which requires an exact DOB match against the license record.
  body('documents.date_of_birth').optional({ nullable: true, checkFalsy: true }).isISO8601()
    .withMessage('date_of_birth must be a valid date'),
];

const rejectKycValidation = [];

// ─── Automated verification (see kyc.controller.js's verifyPan/verifyDrivingLicense/
// sendAadhaarOtp/verifyAadhaarOtp) — separate from the submission validations above since these
// can be called before a full KYC submission exists.
const verifyPanValidation = [
  body('pan').trim().notEmpty().withMessage('pan is required').matches(PAN_REGEX).withMessage('PAN number must be in the format ABCDE1234F'),
  body('name').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 100 }),
];

const verifyDrivingLicenseValidation = [
  body('dl_number').trim().notEmpty().withMessage('dl_number is required').isLength({ min: 5, max: 20 }).withMessage('dl_number looks invalid'),
  body('dob').notEmpty().withMessage('dob is required').isISO8601().withMessage('dob must be a valid date'),
];

const sendAadhaarOtpValidation = [
  body('aadhaar_number').trim().notEmpty().withMessage('aadhaar_number is required').matches(AADHAAR_REGEX).withMessage('aadhaar_number must be 12 digits'),
];

const verifyAadhaarOtpValidation = [
  body('ref_id').trim().notEmpty().withMessage('ref_id is required'),
  body('otp').trim().notEmpty().withMessage('otp is required').isLength({ min: 4, max: 8 }).withMessage('otp looks invalid'),
];

const uploadKycDocumentValidation = [
  body('document_key')
    .trim()
    .notEmpty().withMessage('document_key is required')
    .custom((value, { req }) => {
      const allowed = ALLOWED_DOCUMENT_KEYS[req.user?.role] || [];
      if (!allowed.includes(value)) {
        throw new Error(`document_key must be one of: ${allowed.join(', ')} for a ${req.user?.role} account`);
      }
      return true;
    }),
];

module.exports = {
  submitBrokerKycValidation,
  submitDriverKycValidation,
  rejectKycValidation,
  uploadKycDocumentValidation,
  ALLOWED_DOCUMENT_KEYS,
  verifyPanValidation,
  verifyDrivingLicenseValidation,
  sendAadhaarOtpValidation,
  verifyAadhaarOtpValidation,
};
