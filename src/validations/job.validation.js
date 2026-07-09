const { body } = require('express-validator');

const assignDriverValidation = [
  body('driverId').notEmpty().withMessage('driverId is required').isUUID().withMessage('driverId must be a valid UUID'),
  body('truckId').notEmpty().withMessage('truckId is required').isUUID().withMessage('truckId must be a valid UUID'),
];

module.exports = { assignDriverValidation };
