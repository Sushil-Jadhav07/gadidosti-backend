const { body } = require('express-validator');

const registerValidation = [];
const loginValidation = [];

// Loose Indian vehicle-registration format, e.g. "MH12AB1234" or "MH-12-AB-1234" — mirrors
// vehicle.validation.js's REGISTRATION_REGEX (duplicated rather than cross-imported, since
// the two validation files don't otherwise depend on each other).
const REGISTRATION_REGEX = /^[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{1,4}$/i;
// Mirrors vehicle.validation.js's TRUCK_CATEGORIES/CURRENT_YEAR — the "Truck Type" dropdown on
// this form (Small/Medium/Large/Part) is the same category enum used everywhere else trucks
// are created, not a separate freeform "type" field.
const TRUCK_CATEGORIES = ['small', 'medium', 'large', 'part'];
const CURRENT_YEAR = new Date().getFullYear();

// Self-service signup for an independent owner-operator driver — creates the account and
// their own truck in one request, so this form needs both account fields and full truck
// details up front. Same required/optional split as vehicle.validation.js's
// createTruckValidation (registration/category/capacity required, make/year/insurance_expiry
// optional), for consistency with the broker-driven "Add Truck" flow.
const registerDriverWithTruckValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^\d{10}$/).withMessage('Phone number must be 10 digits'),
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('registration').trim().notEmpty().withMessage('Vehicle registration number is required')
    .matches(REGISTRATION_REGEX).withMessage('Registration number looks invalid, e.g. MH-12-AB-1234'),
  body('category').trim().notEmpty().withMessage('Truck type is required')
    .isIn(TRUCK_CATEGORIES).withMessage(`Truck type must be one of: ${TRUCK_CATEGORIES.join(', ')}`),
  body('capacity').trim().notEmpty().withMessage('Capacity is required'),
  body('make').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 60 }),
  body('year').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1990, max: CURRENT_YEAR + 1 }).withMessage(`Year must be between 1990 and ${CURRENT_YEAR + 1}`),
  body('insurance_expiry').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Insurance expiry must be a valid date'),
  body('password').notEmpty().withMessage('Password is required')
    .isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('confirm_password').notEmpty().withMessage('Please confirm your password')
    .custom((value, { req }) => {
      if (value !== req.body.password) throw new Error('Passwords do not match');
      return true;
    }),
];

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
  registerDriverWithTruckValidation,
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
