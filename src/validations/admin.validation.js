const { body } = require('express-validator');

const updateSettingsValidation = [
  body('platform_name').optional({ nullable: true }).trim().isLength({ min: 2, max: 150 }).withMessage('platform_name must be 2-150 characters'),
  body('contact_email').optional({ nullable: true }).isEmail().withMessage('contact_email must be a valid email').normalizeEmail(),
  body('commission_rate').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('commission_rate must be between 0 and 100'),
  body('email_alerts').optional({ nullable: true }).isBoolean().withMessage('email_alerts must be a boolean'),
  body('sms_alerts').optional({ nullable: true }).isBoolean().withMessage('sms_alerts must be a boolean'),
  body('push_notifications').optional({ nullable: true }).isBoolean().withMessage('push_notifications must be a boolean'),
];

module.exports = { updateSettingsValidation };
