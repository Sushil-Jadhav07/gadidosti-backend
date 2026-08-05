const { body } = require('express-validator');

const deviceTokenValidation = [
  body('token').trim().notEmpty().withMessage('token is required'),
  body('platform').optional({ nullable: true, checkFalsy: true }).isIn(['web', 'android', 'ios']).withMessage('platform must be one of: web, android, ios'),
];

const unregisterDeviceTokenValidation = [
  body('token').trim().notEmpty().withMessage('token is required'),
];

module.exports = { deviceTokenValidation, unregisterDeviceTokenValidation };
