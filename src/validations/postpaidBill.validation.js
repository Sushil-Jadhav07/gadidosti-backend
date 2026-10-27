const { body } = require('express-validator');

const setBillingTypeValidation = [
  body('billing_type').isIn(['prepaid', 'postpaid']).withMessage("billing_type must be 'prepaid' or 'postpaid'"),
  body('credit_limit').optional({ nullable: true, checkFalsy: true }).isFloat({ min: 1 }).withMessage('credit_limit must be a positive number'),
];

const markBillPaidValidation = [
  body('payment_mode').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 50 }),
  body('note').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 500 }),
];

module.exports = { setBillingTypeValidation, markBillPaidValidation };
