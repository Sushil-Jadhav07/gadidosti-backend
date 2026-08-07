const express = require('express');
const router = express.Router();

const { listSettlements, getSettlement, getBrokerAnalytics } = require('../controllers/payment.controller');
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
 * /api/payments/settlements/{id}:
 *   get:
 *     tags: [Payments]
 *     summary: Get a single settlement (broker/driver on it, or admin)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Settlement fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: You do not have access to this settlement
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Settlement not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/payments/settlements/:id', authenticate, authorize('broker', 'driver', 'admin'), getSettlement);

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
