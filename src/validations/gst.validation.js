const { body } = require('express-validator');
const { GST_REGEX } = require('./kyc.validation');

const verifyGstValidation = [
  body('gstin').trim().notEmpty().withMessage('gstin is required').matches(GST_REGEX).withMessage('gstin must be a valid 15-character GSTIN'),
];

module.exports = { verifyGstValidation };
