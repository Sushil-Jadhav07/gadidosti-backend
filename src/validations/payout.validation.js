const { body } = require('express-validator');

const logPayoutValidation = [
  body('amount').isFloat({ min: 0.01 }).withMessage('amount must be a positive number'),
  body('note').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 500 }),
];

const setCommissionRateValidation = [
  body('commission_rate')
    .custom((value) => value === null || (typeof value === 'number' && value >= 0 && value <= 100))
    .withMessage('commission_rate must be a number between 0 and 100, or null'),
];

module.exports = { logPayoutValidation, setCommissionRateValidation };
