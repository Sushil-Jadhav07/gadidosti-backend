const express = require('express');
const router = express.Router();

const { downloadBilty, sendBilty } = require('../controllers/bilty.controller');
const { authenticate } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/bookings/{id}/bilty:
 *   get:
 *     tags: [Bilty]
 *     summary: Download a booking's Bilty (Lorry Receipt) as a PDF (client/broker/driver on it, or admin)
 *     description: A separate document from the GST tax invoice — the transporter's own goods-receipt, not a tax document.
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
router.get('/bookings/:id/bilty', authenticate, downloadBilty);

/**
 * @swagger
 * /api/bookings/{id}/bilty/send:
 *   post:
 *     tags: [Bilty]
 *     summary: Email the Bilty to the client on this booking (one-click, always to the client's own address)
 *     description: Also sent automatically the moment a trip is marked Delivered — this is for a manual resend.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Bilty sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: Client has no email on file
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/:id/bilty/send', authenticate, sendBilty);

module.exports = router;
