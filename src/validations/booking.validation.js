const { body } = require('express-validator');

const createBookingValidation = [
  body('pickup_location').trim().notEmpty().withMessage('Pickup location is required'),
  body('drop_location').trim().notEmpty().withMessage('Drop location is required'),
  body('pickup_lat').optional({ nullable: true }).isFloat().withMessage('pickup_lat must be a number'),
  body('pickup_lng').optional({ nullable: true }).isFloat().withMessage('pickup_lng must be a number'),
  body('drop_lat').optional({ nullable: true }).isFloat().withMessage('drop_lat must be a number'),
  body('drop_lng').optional({ nullable: true }).isFloat().withMessage('drop_lng must be a number'),
  body('truck_category').optional({ nullable: true }).isIn(['small', 'medium', 'large', 'part']).withMessage('Invalid truck_category'),
  body('transport_type').optional({ nullable: true }).isIn(['intra', 'inter']).withMessage('transport_type must be intra or inter'),
  body('weight').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('weight must be a positive number'),
  body('quantity').optional({ nullable: true }).isInt({ min: 0 }).withMessage('quantity must be a positive integer'),
  body('distance').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('distance must be a positive number'),
  body('amount').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('amount must be a positive number'),
  body('payment_status').optional({ nullable: true }).isIn(['paid', 'pending']).withMessage('payment_status must be paid or pending'),
];

const updateBookingStatusValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled'])
    .withMessage('Invalid booking status'),
  body('driver_id').optional({ nullable: true }).isUUID().withMessage('driver_id must be a valid UUID'),
  body('truck_id').optional({ nullable: true }).isUUID().withMessage('truck_id must be a valid UUID'),
];

const rateBookingValidation = [
  body('stars').notEmpty().withMessage('stars is required').isInt({ min: 1, max: 5 }).withMessage('stars must be between 1 and 5'),
  body('review').optional({ nullable: true }).isString().withMessage('review must be a string'),
];

module.exports = { createBookingValidation, updateBookingStatusValidation, rateBookingValidation };
