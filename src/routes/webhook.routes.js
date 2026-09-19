const express = require('express');
const router = express.Router();

const { razorpayWebhook } = require('../controllers/webhook.controller');

/**
 * @swagger
 * /api/webhooks/razorpay:
 *   post:
 *     tags: [Payments]
 *     summary: Razorpay webhook receiver (public — called by Razorpay, not the app's own clients)
 *     description: |
 *       Configure this URL on the Razorpay Dashboard (Settings -> Webhooks), subscribed to at
 *       least the `qr_code.credited` event, with RAZORPAY_WEBHOOK_SECRET set to the secret shown
 *       there when the webhook is created. Verifies the X-Razorpay-Signature header before
 *       acting on anything.
 *     responses:
 *       200:
 *         description: Always 200 once the signature checks out, even for events this app ignores — Razorpay retries non-2xx responses.
 *       400:
 *         description: Missing/invalid signature
 */
router.post('/webhooks/razorpay', razorpayWebhook);

module.exports = router;
