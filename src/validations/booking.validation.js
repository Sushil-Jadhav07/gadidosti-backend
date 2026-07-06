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
  body('broker_id').optional({ nullable: true }).isUUID().withMessage('broker_id must be a valid UUID'),
  body('truck_id').optional({ nullable: true }).isUUID().withMessage('truck_id must be a valid UUID'),
];

const updateBookingStatusValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['pending', 'confirmed', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled'])
    .withMessage('Invalid booking status'),
  body('driver_id').optional({ nullable: true }).isUUID().withMessage('driver_id must be a valid UUID'),
  body('truck_id').optional({ nullable: true }).isUUID().withMessage('truck_id must be a valid UUID'),
];

module.exports = { createBookingValidation, updateBookingStatusValidation };
