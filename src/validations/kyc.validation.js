const { body } = require('express-validator');

const submitKycValidation = [
  body('documents')
    .isObject({ strict: true }).withMessage('documents must be an object of document number fields')
    .custom((docs) => Object.keys(docs).length > 0).withMessage('At least one document field is required')
    .custom((docs) => Object.values(docs).every((v) => typeof v === 'string' && v.trim().length > 0))
    .withMessage('Document values must be non-empty strings'),
];

const reviewKycValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected'),

  body('reason')
    .if(body('status').equals('rejected'))
    .trim().notEmpty().withMessage('A rejection reason is required when rejecting KYC'),
];

module.exports = { submitKycValidation, reviewKycValidation };
