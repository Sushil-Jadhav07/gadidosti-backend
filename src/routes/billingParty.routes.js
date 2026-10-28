const express = require('express');
const router = express.Router();

const { listBillingParties } = require('../controllers/billingParty.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/billing-parties:
 *   get:
 *     tags: [Billing]
 *     summary: List this client's saved "Receiver Pays" parties (name + GSTIN), newest first
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Billing parties fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/billing-parties', authenticate, authorize('client'), listBillingParties);

module.exports = router;
