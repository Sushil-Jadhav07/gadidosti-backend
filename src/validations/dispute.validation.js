const { body } = require('express-validator');

const ISSUE_TYPES = [
  'damaged_goods', 'payment_delay', 'cancellation_fee', 'route_dispute',
  'late_delivery', 'fuel_surcharge', 'wrong_items', 'weight_discrepancy',
];

const createDisputeValidation = [
  body('booking_id').notEmpty().withMessage('booking_id is required').isUUID().withMessage('booking_id must be a valid UUID'),
  body('issue_type').notEmpty().withMessage('issue_type is required').isIn(ISSUE_TYPES).withMessage('Invalid issue_type'),
  body('description').trim().notEmpty().withMessage('description is required').isLength({ max: 2000 }).withMessage('description too long'),
];

const resolveDisputeValidation = [
  body('resolution').trim().notEmpty().withMessage('resolution is required'),
];

module.exports = { ISSUE_TYPES, createDisputeValidation, resolveDisputeValidation };
