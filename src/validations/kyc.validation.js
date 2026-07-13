const { body } = require('express-validator');

// The only document_key values the frontend ever uploads under — must match urlField in
// SSK broker-driver/app/src/pages/broker/KYCStatus.jsx and driver/KYC.jsx exactly, since
// POST /api/kyc/documents/upload merges the file's url into kyc_submissions.documents
// under this same key.
const ALLOWED_DOCUMENT_KEYS = {
  broker: ['pan_photo_url', 'aadhaar_photo_url'],
  driver: ['license_photo_url', 'aadhaar_photo_url'],
};

const submitBrokerKycValidation = [];
const submitDriverKycValidation = [];
const rejectKycValidation = [];

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
};
