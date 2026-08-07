const express = require('express');
const router = express.Router();

const { downloadInvoice, emailInvoice } = require('../controllers/invoice.controller');
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

module.exports = router;
