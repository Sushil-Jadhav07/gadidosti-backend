const { body } = require('express-validator');

const TRUCK_CATEGORIES = ['small', 'medium', 'large', 'part'];
// Loose Indian vehicle-registration format, e.g. "MH12AB1234" or "MH-12-AB-1234".
const REGISTRATION_REGEX = /^[A-Z]{2}[-\s]?\d{1,2}[-\s]?[A-Z]{1,3}[-\s]?\d{1,4}$/i;
const CURRENT_YEAR = new Date().getFullYear();

const createTruckValidation = [
  body('registration').trim().notEmpty().withMessage('Registration number is required')
    .matches(REGISTRATION_REGEX).withMessage('Registration number looks invalid, e.g. MH-12-AB-1234'),
  body('type').trim().notEmpty().withMessage('Truck type is required'),
  body('category').trim().notEmpty().withMessage('Category is required')
    .isIn(TRUCK_CATEGORIES).withMessage(`Category must be one of: ${TRUCK_CATEGORIES.join(', ')}`),
  body('capacity').trim().notEmpty().withMessage('Capacity is required'),
  body('make').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 60 }),
  body('year').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1990, max: CURRENT_YEAR + 1 }).withMessage(`Year must be between 1990 and ${CURRENT_YEAR + 1}`),
  body('insurance_expiry').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Insurance expiry must be a valid date'),
];

const updateTruckValidation = [
  body('category').optional({ nullable: true, checkFalsy: true }).trim()
    .isIn(TRUCK_CATEGORIES).withMessage(`Category must be one of: ${TRUCK_CATEGORIES.join(', ')}`),
  body('capacity').optional({ nullable: true, checkFalsy: true }).trim().notEmpty().withMessage('Capacity cannot be blank'),
  body('type').optional({ nullable: true, checkFalsy: true }).trim().notEmpty().withMessage('Truck type cannot be blank'),
  body('make').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 60 }),
  body('year').optional({ nullable: true, checkFalsy: true }).isInt({ min: 1990, max: CURRENT_YEAR + 1 }).withMessage(`Year must be between 1990 and ${CURRENT_YEAR + 1}`),
  body('insurance_expiry').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('Insurance expiry must be a valid date'),
  body('status').optional({ nullable: true, checkFalsy: true }).isIn(['available', 'on_trip', 'maintenance']).withMessage('Invalid status'),
];

const createDriverValidation = [];

const updateDriverValidation = [
  body('license_no').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 20 }),
  body('license_expiry').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('License expiry must be a valid date'),
  body('aadhaar').optional({ nullable: true, checkFalsy: true }).trim().matches(/^\d{12}$/).withMessage('Aadhaar must be 12 digits'),
  body('status').optional({ nullable: true, checkFalsy: true }).isIn(['available', 'on_trip', 'offline']).withMessage('Invalid status'),
];

const registerDriverValidation = [
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('phone').trim().notEmpty().withMessage('Phone number is required')
    .matches(/^\d{10}$/).withMessage('Phone number must be 10 digits'),
  body('email').trim().notEmpty().withMessage('Email is required').isEmail().withMessage('Enter a valid email address'),
  body('license_no').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 20 }),
  body('license_expiry').optional({ nullable: true, checkFalsy: true }).isISO8601().withMessage('License expiry must be a valid date'),
  body('aadhaar').optional({ nullable: true, checkFalsy: true }).trim().matches(/^\d{12}$/).withMessage('Aadhaar must be 12 digits'),
];

const updateDriverLocationValidation = [
  body('lat').isFloat({ min: -90, max: 90 }).withMessage('lat must be a valid latitude'),
  body('lng').isFloat({ min: -180, max: 180 }).withMessage('lng must be a valid longitude'),
];

module.exports = {
  createTruckValidation, updateTruckValidation, createDriverValidation, updateDriverValidation,
  registerDriverValidation, updateDriverLocationValidation,
};
