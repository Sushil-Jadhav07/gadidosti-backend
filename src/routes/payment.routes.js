const express = require('express');
const router = express.Router();

const { listSettlements, getBrokerAnalytics } = require('../controllers/payment.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/payments/settlements:
 *   get:
 *     tags: [Payments]
 *     summary: List settlements (role-scoped)
 *     description: broker/driver -> own settlements, admin -> all. Every row includes platformFee and netEarnings.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Settlements fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/payments/settlements', authenticate, authorize('broker', 'driver', 'admin'), listSettlements);

/**
 * @swagger
 * /api/analytics/broker:
 *   get:
 *     tags: [Payments]
 *     summary: Broker/driver earnings analytics
 *     description: Returns { thisMonth, lastMonth, tripHistory[] } for the earnings screen.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Earnings analytics fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/analytics/broker', authenticate, authorize('broker', 'driver'), getBrokerAnalytics);

module.exports = router;
