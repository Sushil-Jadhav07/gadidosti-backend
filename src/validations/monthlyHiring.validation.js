const { body } = require('express-validator');

const PRICING_TYPES = ['fixed', 'per_km'];
const TRUCK_CATEGORIES = ['small', 'medium', 'large', 'part'];

const createEnquiryValidation = [
  body('location').isString().trim().notEmpty().withMessage('location is required'),
  body('pricing_type').isIn(PRICING_TYPES).withMessage(`pricing_type must be one of ${PRICING_TYPES.join(', ')}`),
  body('truck_category').optional().isIn(TRUCK_CATEGORIES).withMessage(`truck_category must be one of ${TRUCK_CATEGORIES.join(', ')}`),
  body('duration_months').optional().isInt({ min: 1 }).withMessage('duration_months must be a positive number'),
  body('budget_amount').optional().isFloat({ min: 0 }).withMessage('budget_amount must be a positive number'),
  body('description').optional().isString().trim().isLength({ max: 2000 }),
];

const createListingValidation = [
  body('truck_id').isUUID().withMessage('truck_id is required'),
  body('pricing_type').isIn(PRICING_TYPES).withMessage(`pricing_type must be one of ${PRICING_TYPES.join(', ')}`),
  body('rate_amount').isFloat({ gt: 0 }).withMessage('rate_amount is required and must be greater than 0'),
  body('availability_notes').optional().isString().trim().isLength({ max: 1000 }),
];

const updateListingStatusValidation = [
  body('status').isIn(['active', 'inactive']).withMessage("status must be 'active' or 'inactive'"),
];

const adminUpdateEnquiryStatusValidation = [
  body('status').isIn(['open', 'contacted', 'closed']).withMessage("status must be 'open', 'contacted', or 'closed'"),
];

module.exports = {
  createEnquiryValidation, createListingValidation, updateListingStatusValidation, adminUpdateEnquiryStatusValidation,
};
