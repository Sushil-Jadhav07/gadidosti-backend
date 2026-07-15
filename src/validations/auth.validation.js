const { body } = require('express-validator');

const registerValidation = [];
const loginValidation = [];

// Matches the contract already documented in auth.routes.js's swagger block for
// POST /api/auth/admin/register ("Email is required for admin accounts").
const registerAdminValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^\d{10}$/).withMessage('Phone number must be 10 digits'),
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];
const sendOtpValidation = [];
const verifyOtpValidation = [];
const forgotPasswordValidation = [];
const resetPasswordValidation = [];
const refreshTokenValidation = [];
const updateProfileValidation = [];
const changePasswordValidation = [];
const googleSignInValidation = [];
const updateUserStatusValidation = [];

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
