const express = require('express');
const router = express.Router();

const { listPayoutCandidates, getPayoutDetail, logPayout, setCommissionRate } = require('../controllers/payout.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { logPayoutValidation, setCommissionRateValidation } = require('../validations/payout.validation');

// Deliberately NOT gated by requireAdminPage/ADMIN_PAGE_KEYS — authorize('admin') only, never
// 'staff'. This handles real money, same "superadmin-only" reasoning as geofencing.

/**
 * @swagger
 * /api/admin/payouts:
 *   get:
 *     tags: [Payouts]
 *     summary: List every driver/broker with their earnings-wallet balance and commission rate (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [driver, broker] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Candidates fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/payouts', authenticate, authorize('admin'), listPayoutCandidates);

/**
 * @swagger
 * /api/admin/payouts/{userId}:
 *   get:
 *     tags: [Payouts]
 *     summary: One driver/broker's wallet balance + transaction history (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Detail fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Driver/broker not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/admin/payouts/:userId', authenticate, authorize('admin'), getPayoutDetail);

/**
 * @swagger
 * /api/admin/payouts/{userId}:
 *   post:
 *     tags: [Payouts]
 *     summary: Log a manual payout, debiting it from the earnings-wallet balance (admin only)
 *     description: Records that the superadmin paid this person outside the system (bank transfer, UPI, cash). No per-order tracking — just reduces the running balance.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number, example: 3000 }
 *               note: { type: string, example: "Paid via UPI, ref #12345" }
 *     responses:
 *       200:
 *         description: Payout logged
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       402:
 *         description: Amount exceeds the current balance
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/admin/payouts/:userId', authenticate, authorize('admin'), logPayoutValidation, validate, logPayout);

/**
 * @swagger
 * /api/admin/payouts/{userId}/commission:
 *   patch:
 *     tags: [Payouts]
 *     summary: Set (or clear) a driver/broker's commission-rate override (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [commission_rate]
 *             properties:
 *               commission_rate: { type: number, nullable: true, example: 8, description: "0-100, or null to clear the override and use the global default" }
 *     responses:
 *       200:
 *         description: Commission rate updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.patch('/admin/payouts/:userId/commission', authenticate, authorize('admin'), setCommissionRateValidation, validate, setCommissionRate);

module.exports = router;
