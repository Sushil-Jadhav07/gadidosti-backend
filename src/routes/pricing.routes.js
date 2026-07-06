const express = require('express');
const router = express.Router();

const { getPricingConfig, updatePricingConfig } = require('../controllers/pricing.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { updatePricingConfigValidation } = require('../validations/pricing.validation');

/**
 * @swagger
 * /api/admin/pricing:
 *   get:
 *     tags: [Pricing]
 *     summary: Get pricing configuration (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pricing configuration fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/pricing', authenticate, authorize('admin'), getPricingConfig);

/**
 * @swagger
 * /api/admin/pricing:
 *   put:
 *     tags: [Pricing]
 *     summary: Replace pricing configuration (admin only)
 *     description: Body is the full nested config object (intraCity/interCity/partTruck) — see PricingConfig schema.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PricingConfig'
 *     responses:
 *       200:
 *         description: Pricing configuration updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/admin/pricing', authenticate, authorize('admin'), updatePricingConfigValidation, validate, updatePricingConfig);

module.exports = router;
