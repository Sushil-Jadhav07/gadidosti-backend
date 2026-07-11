const { body } = require('express-validator');

const updateServiceCityValidation = [
  body('service_city').isString().trim().notEmpty().withMessage('service_city is required'),
];

const updateAvailabilityValidation = [
  body('is_online').isBoolean().withMessage('is_online must be a boolean'),
];

module.exports = { updateServiceCityValidation, updateAvailabilityValidation };
