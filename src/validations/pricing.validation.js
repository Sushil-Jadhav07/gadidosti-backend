const { body } = require('express-validator');

const estimatePricingValidation = [
  body('truck_category').notEmpty().withMessage('truck_category is required')
    .isIn(['small', 'medium', 'large', 'part']).withMessage('Invalid truck_category'),
  body('transport_type').optional({ nullable: true }).isIn(['intra', 'inter']).withMessage('transport_type must be intra or inter'),
  body('distance').notEmpty().withMessage('distance is required').isFloat({ min: 0 }).withMessage('distance must be a positive number'),
  body('capacity_used_pct').optional({ nullable: true }).isFloat({ min: 0, max: 100 }).withMessage('capacity_used_pct must be between 0 and 100'),
];

const updatePricingConfigValidation = [
  body().custom((value) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length === 0) {
      throw new Error('Request body must be a non-empty pricing configuration object');
    }
    return true;
  }),
];

module.exports = { estimatePricingValidation, updatePricingConfigValidation };
