const { body } = require('express-validator');

const createTruckValidation = [
  body('registration').trim().notEmpty().withMessage('registration is required'),
  body('category').optional({ nullable: true }).isIn(['small', 'medium', 'large', 'part']).withMessage('Invalid category'),
  body('year').optional({ nullable: true }).isInt({ min: 1980 }).withMessage('year must be a valid year'),
  body('insurance_expiry').optional({ nullable: true }).isISO8601().withMessage('insurance_expiry must be a valid date'),
  body('driver_id').optional({ nullable: true }).isUUID().withMessage('driver_id must be a valid UUID'),
];

const updateTruckValidation = [
  body('category').optional({ nullable: true }).isIn(['small', 'medium', 'large', 'part']).withMessage('Invalid category'),
  body('status').optional({ nullable: true }).isIn(['available', 'on_trip', 'maintenance']).withMessage('Invalid status'),
  body('year').optional({ nullable: true }).isInt({ min: 1980 }).withMessage('year must be a valid year'),
  body('insurance_expiry').optional({ nullable: true }).isISO8601().withMessage('insurance_expiry must be a valid date'),
  body('driver_id').optional({ nullable: true }).isUUID().withMessage('driver_id must be a valid UUID'),
];

const createDriverValidation = [
  body('user_id').notEmpty().withMessage('user_id is required').isUUID().withMessage('user_id must be a valid UUID'),
  body('license_no').optional({ nullable: true }).trim().isLength({ max: 50 }).withMessage('license_no too long'),
  body('license_expiry').optional({ nullable: true }).isISO8601().withMessage('license_expiry must be a valid date'),
  body('aadhaar').optional({ nullable: true }).trim().isLength({ min: 12, max: 14 }).withMessage('aadhaar must be 12 digits'),
  body('truck_id').optional({ nullable: true }).isUUID().withMessage('truck_id must be a valid UUID'),
];

const updateDriverValidation = [
  body('license_expiry').optional({ nullable: true }).isISO8601().withMessage('license_expiry must be a valid date'),
  body('truck_id').optional({ nullable: true }).isUUID().withMessage('truck_id must be a valid UUID'),
  body('status').optional({ nullable: true }).isIn(['available', 'on_trip', 'offline']).withMessage('Invalid status'),
];

module.exports = { createTruckValidation, updateTruckValidation, createDriverValidation, updateDriverValidation };
