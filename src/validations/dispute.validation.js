const { body } = require('express-validator');

const ISSUE_TYPES = [
  'damaged_goods', 'payment_delay', 'cancellation_fee', 'route_dispute',
  'late_delivery', 'fuel_surcharge', 'wrong_items', 'weight_discrepancy',
];

const createDisputeValidation = [
  body('booking_id').trim().notEmpty().withMessage('booking_id is required'),
  body('issue_type').trim().notEmpty().withMessage('issue_type is required')
    .isIn(ISSUE_TYPES).withMessage(`issue_type must be one of: ${ISSUE_TYPES.join(', ')}`),
  body('description').trim().notEmpty().withMessage('description is required')
    .isLength({ max: 2000 }).withMessage('description must be 2000 characters or fewer'),
];

const resolveDisputeValidation = [
  body('resolution').trim().notEmpty().withMessage('resolution is required')
    .isLength({ max: 2000 }).withMessage('resolution must be 2000 characters or fewer'),
];

module.exports = { ISSUE_TYPES, createDisputeValidation, resolveDisputeValidation };
