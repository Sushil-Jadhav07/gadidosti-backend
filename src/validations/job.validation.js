const { body } = require('express-validator');

const assignDriverValidation = [];

const counterOfferValidation = [
  body('amount').isFloat({ min: 1 }).withMessage('amount must be a positive number'),
  body('note').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 500 }).withMessage('note must be 500 characters or fewer'),
];

module.exports = { assignDriverValidation, counterOfferValidation };
