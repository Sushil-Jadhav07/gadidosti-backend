const { body } = require('express-validator');

const createBookingValidation = [];

// 'completed' is deliberately excluded — that transition must go through
// PATCH /api/trips/:id/status so its settlement side effects aren't bypassed
// (see the admin-only escape-hatch comment on updateBookingStatus in booking.controller.js).
const BOOKING_STATUS_OVERRIDE_VALUES = [
  'pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up',
  'in_transit', 'delivered', 'cancelled', 'no_broker_available',
];

const updateBookingStatusValidation = [
  body('status').trim().notEmpty().withMessage('status is required')
    .isIn(BOOKING_STATUS_OVERRIDE_VALUES).withMessage(`status must be one of: ${BOOKING_STATUS_OVERRIDE_VALUES.join(', ')} ('completed' must go through PATCH /api/trips/:id/status instead)`),
  body('driver_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('driver_id must be a valid UUID'),
  body('truck_id').optional({ nullable: true, checkFalsy: true }).isUUID().withMessage('truck_id must be a valid UUID'),
];

// Client Rating — matches the contract already documented in booking.routes.js's swagger block.
const rateBookingValidation = [
  body('stars').isInt({ min: 1, max: 5 }).withMessage('stars must be an integer from 1 to 5'),
  body('review').optional({ nullable: true }).isString().isLength({ max: 1000 }).withMessage('review must be 1000 characters or fewer'),
];

module.exports = { createBookingValidation, updateBookingStatusValidation, rateBookingValidation };
