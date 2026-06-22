const { body } = require('express-validator');

const registerValidation = [
  body('name')
    .trim().notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),

  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail().withMessage('Enter a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase and a number'),

  body('role')
    .optional()
    .isIn(['client', 'broker', 'driver']).withMessage('Role must be client, broker, or driver'),
];

const loginValidation = [
  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('password')
    .notEmpty().withMessage('Password is required'),
];

const sendOtpValidation = [
  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('purpose')
    .optional()
    .isIn(['registration', 'login', 'password_reset', 'phone_verify']).withMessage('Invalid OTP purpose'),
];

const verifyOtpValidation = [
  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('otp')
    .trim().notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be numeric'),

  body('purpose')
    .optional()
    .isIn(['registration', 'login', 'password_reset', 'phone_verify']).withMessage('Invalid OTP purpose'),
];

const refreshTokenValidation = [
  body('refresh_token')
    .notEmpty().withMessage('Refresh token is required'),
];

const updateProfileValidation = [
  body('name')
    .optional()
    .trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),

  body('email')
    .optional({ nullable: true, checkFalsy: true })
    .isEmail().withMessage('Enter a valid email address')
    .normalizeEmail(),
];

const changePasswordValidation = [
  body('current_password')
    .notEmpty().withMessage('Current password is required'),

  body('new_password')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage('Password must contain uppercase, lowercase and a number'),
];

const updateUserStatusValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['active', 'inactive', 'blocked']).withMessage('Status must be active, inactive, or blocked'),
];

module.exports = {
  registerValidation,
  loginValidation,
  sendOtpValidation,
  verifyOtpValidation,
  refreshTokenValidation,
  updateProfileValidation,
  changePasswordValidation,
  updateUserStatusValidation,
};
