const { body } = require('express-validator');

const updateTripStatusValidation = [
  body('status')
    .notEmpty().withMessage('Status is required')
    .isIn(['confirmed', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed', 'cancelled'])
    .withMessage('Invalid trip status'),
];

const updateTripLocationValidation = [
  body('lat').notEmpty().withMessage('lat is required').isFloat().withMessage('lat must be a number'),
  body('lng').notEmpty().withMessage('lng is required').isFloat().withMessage('lng must be a number'),
];

module.exports = { updateTripStatusValidation, updateTripLocationValidation };
