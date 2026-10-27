const { body } = require('express-validator');

const createRechargeOrderValidation = [
  body('amount').isFloat({ min: 1 }).withMessage('amount must be a positive number'),
];

const verifyRechargeValidation = [
  body('order_id').trim().notEmpty().withMessage('order_id is required'),
];

module.exports = { createRechargeOrderValidation, verifyRechargeValidation };
