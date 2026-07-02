const { body } = require('express-validator');

// Required document keys per role, per the KYC spec:
//   Broker  needs PAN, Aadhaar, GST, Bank Account, Business Registration
//   Driver  needs Driving License, Aadhaar, Vehicle Documents (registration + insurance)
const BROKER_REQUIRED_DOCS = ['pan_number', 'aadhaar_number', 'gst_number', 'bank_account_number', 'business_registration_number'];
const DRIVER_REQUIRED_DOCS = ['license_number', 'aadhaar_number', 'vehicle_registration_number', 'vehicle_insurance_number'];

const documentsShapeValidation = body('documents')
  .isObject({ strict: true }).withMessage('documents must be an object of document number fields')
  .custom((docs) => Object.values(docs).every((v) => typeof v === 'string' && v.trim().length > 0))
  .withMessage('Document values must be non-empty strings');

const requiredDocsValidation = (requiredKeys) =>
  body('documents').custom((docs) => {
    const missing = requiredKeys.filter((key) => !docs || !String(docs[key] || '').trim());
    if (missing.length) {
      throw new Error(`Missing required documents: ${missing.join(', ')}`);
    }
    return true;
  });

const submitBrokerKycValidation = [documentsShapeValidation, requiredDocsValidation(BROKER_REQUIRED_DOCS)];
const submitDriverKycValidation = [documentsShapeValidation, requiredDocsValidation(DRIVER_REQUIRED_DOCS)];

const rejectKycValidation = [
  body('reason')
    .trim().notEmpty().withMessage('A rejection reason is required'),
];

module.exports = {
  BROKER_REQUIRED_DOCS,
  DRIVER_REQUIRED_DOCS,
  submitBrokerKycValidation,
  submitDriverKycValidation,
  rejectKycValidation,
};
