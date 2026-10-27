const express = require('express');
const router = express.Router();

const { getWallet, listTransactions, createRechargeOrder, verifyRecharge } = require('../controllers/wallet.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { createRechargeOrderValidation, verifyRechargeValidation } = require('../validations/wallet.validation');

/**
 * @swagger
 * /api/wallet:
 *   get:
 *     tags: [Wallet]
 *     summary: Get own wallet balance (client's prepaid balance, or a driver/broker's earnings balance)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/wallet', authenticate, authorize('client', 'driver', 'broker'), getWallet);

/**
 * @swagger
 * /api/wallet/transactions:
 *   get:
 *     tags: [Wallet]
 *     summary: List own wallet transactions (client's recharges/payments, or a driver/broker's earnings/payouts)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Transactions fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/wallet/transactions', authenticate, authorize('client', 'driver', 'broker'), listTransactions);

/**
 * @swagger
 * /api/wallet/recharge/order:
 *   post:
 *     tags: [Wallet]
 *     summary: Open a payment gateway order to recharge the wallet (client only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [amount]
 *             properties:
 *               amount: { type: number, example: 500 }
 *     responses:
 *       200:
 *         description: Order created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/wallet/recharge/order', authenticate, authorize('client'), createRechargeOrderValidation, validate, createRechargeOrder);

/**
 * @swagger
 * /api/wallet/recharge/verify:
 *   post:
 *     tags: [Wallet]
 *     summary: Verify the gateway payment and credit the wallet (client only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [order_id]
 *             properties:
 *               order_id: { type: string }
 *     responses:
 *       200:
 *         description: Wallet recharged
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       402:
 *         description: Payment verification failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/wallet/recharge/verify', authenticate, authorize('client'), verifyRechargeValidation, validate, verifyRecharge);

module.exports = router;
