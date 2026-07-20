const { body } = require('express-validator');

const sendMessageValidation = [
  body('message').trim().notEmpty().withMessage('message is required')
    .isLength({ max: 2000 }).withMessage('message must be 2000 characters or fewer'),
];

module.exports = { sendMessageValidation };
