const { body } = require('express-validator');

// registration is intentionally optional — omitting/blanking it is the unlink path (see
// tracking.controller.js's linkDeviceToTruck).
const linkDeviceToTruckValidation = [
  body('registration').optional({ nullable: true, checkFalsy: true }).trim().isLength({ max: 20 }),
];

module.exports = { linkDeviceToTruckValidation };
