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
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),

  body('role')
    .optional()
    .isIn(['client', 'broker', 'driver']).withMessage('Role must be client, broker, or driver'),
];

const loginValidation = [
  body('email')
    .optional()
    .isEmail().withMessage('Enter a valid email address')
    .normalizeEmail(),

  body('phone')
    .optional()
    .trim()
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('password')
    .notEmpty().withMessage('Password is required'),

  body().custom((_, { req }) => {
    if (!req.body.email && !req.body.phone) {
      throw new Error('Either email or phone is required');
    }
    return true;
  }),
];

const registerAdminValidation = [
  body('name')
    .trim().notEmpty().withMessage('Name is required')
    .isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),

  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('email')
    .trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Enter a valid email address')
    .normalizeEmail(),

  body('password')
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
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

const forgotPasswordValidation = [
  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),
];

const resetPasswordValidation = [
  body('phone')
    .trim().notEmpty().withMessage('Phone number is required')
    .matches(/^[6-9]\d{9}$/).withMessage('Enter a valid 10-digit Indian mobile number'),

  body('otp')
    .trim().notEmpty().withMessage('OTP is required')
    .isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits')
    .isNumeric().withMessage('OTP must be numeric'),

  body('new_password')
    .notEmpty().withMessage('New password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
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
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
];

const googleSignInValidation = [
  body('id_token')
    .notEmpty().withMessage('Google id_token is required'),

  body('role')
    .optional()
    .isIn(['client', 'broker', 'driver']).withMessage('Role must be client, broker, or driver'),
];

const updateUserStatusValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['active', 'inactive', 'blocked']).withMessage('Status must be active, inactive, or blocked'),
];

module.exports = {
  registerValidation,
  registerAdminValidation,
  loginValidation,
  sendOtpValidation,
  verifyOtpValidation,
  forgotPasswordValidation,
  resetPasswordValidation,
  refreshTokenValidation,
  updateProfileValidation,
  changePasswordValidation,
  googleSignInValidation,
  updateUserStatusValidation,
};
