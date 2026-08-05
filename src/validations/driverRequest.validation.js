const { body } = require('express-validator');

const requestTruckValidation = [
  body('truck_id').notEmpty().withMessage('truck_id is required').isUUID().withMessage('truck_id must be a valid UUID'),
];

// Same shape as job.validation.js's counterOfferValidation, mirrored for consistency —
// driver/broker counters and client counters on driver_requests both use this.
const driverCounterOfferValidation = [
  body('amount').isFloat({ min: 1 }).withMessage('amount must be a positive number'),
  body('note').optional({ nullable: true, checkFalsy: true }).isString().isLength({ max: 500 }).withMessage('note must be 500 characters or fewer'),
];

module.exports = { requestTruckValidation, driverCounterOfferValidation };
