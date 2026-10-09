const { body } = require('express-validator');

const createTripJoinRequestValidation = [
  body('booking_id').notEmpty().withMessage('booking_id is required').isUUID().withMessage('booking_id must be a valid UUID'),
  body('target_trip_id').notEmpty().withMessage('target_trip_id is required').isUUID().withMessage('target_trip_id must be a valid UUID'),
];

module.exports = { createTripJoinRequestValidation };
