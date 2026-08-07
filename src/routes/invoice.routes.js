const express = require('express');
const router = express.Router();

const { downloadInvoice, emailInvoice, notifyPortal } = require('../controllers/invoice.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/bookings/{id}/invoice:
 *   get:
 *     tags: [Invoice]
 *     summary: Download a booking's invoice as a PDF (client/broker/driver on it, or admin)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: PDF file
 *         content:
 *           application/pdf: {}
 *       403:
 *         description: You do not have access to this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/bookings/:id/invoice', authenticate, downloadInvoice);

/**
 * @swagger
 * /api/bookings/{id}/invoice/email:
 *   post:
 *     tags: [Invoice]
 *     summary: Email the invoice (manual send only — to/subject/message all required, no auto-send)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [to, subject, message]
 *             properties:
 *               to: { type: string, format: email }
 *               subject: { type: string }
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: Invoice sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: to, subject, and message are required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/:id/invoice/email', authenticate, emailInvoice);

/**
 * @swagger
 * /api/bookings/{id}/invoice/notify:
 *   post:
 *     tags: [Invoice]
 *     summary: "Send-to-portal: notify the client in-app that the broker/driver shared their invoice"
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Client notified
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Only the broker or driver on this booking can use this
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/:id/invoice/notify', authenticate, notifyPortal);

module.exports = router;
