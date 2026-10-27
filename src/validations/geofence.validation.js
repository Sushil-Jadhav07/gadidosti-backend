const { body } = require('express-validator');

const PINCODE_REGEX = /^\d{6}$/;

const createPincodeValidation = [
  body('pincode').trim().notEmpty().withMessage('pincode is required').matches(PINCODE_REGEX).withMessage('pincode must be 6 digits'),
  body('label').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 100 }),
];

const setPincodeActiveValidation = [
  body('active').isBoolean().withMessage('active must be a boolean'),
];

module.exports = { createPincodeValidation, setPincodeActiveValidation, PINCODE_REGEX };
