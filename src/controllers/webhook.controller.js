const crypto = require('crypto');
const TripModel = require('../models/trip.model');
const { finalizeTripPayment } = require('./trip.controller');
const RazorpayPaymentProvider = require('../providers/payment/RazorpayPaymentProvider');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');

// ─── POST /api/webhooks/razorpay ────────────────────────────────────────────────
// Public — Razorpay calls this directly, there's no user session to authenticate. Configured
// on the Razorpay Dashboard (Settings -> Webhooks) pointing at this URL, with RAZORPAY_WEBHOOK_SECRET
// (a separate secret from the API key/secret pair, generated when the webhook is created there)
// set to match. Handles exactly one event this app cares about: qr_code.credited, fired the
// moment a Razorpay QR code (createPaymentQrCode in trip.controller.js) is actually paid — this
// is the authoritative, real-time confirmation; GET /api/trips/:id/collect-payment/qr/status is
// just an on-demand poll for immediate UI feedback while the driver has the screen open, not the
// primary source of truth.
const razorpayWebhook = async (req, res, next) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    const signature = req.headers['x-razorpay-signature'];
    if (!secret) {
      // Not configured yet — ack with 200 so Razorpay doesn't retry-storm an endpoint that will
      // never work until the dashboard side is set up, but log loudly since this means every QR
      // payment is currently only ever confirmed by the driver's own poll, never the webhook.
      logger.warn('Razorpay webhook received but RAZORPAY_WEBHOOK_SECRET is not set — ignoring');
      return successResponse(res, 200, 'Webhook secret not configured');
    }
    if (!signature || !req.rawBody) {
      return errorResponse(res, 400, 'Missing signature or body');
    }

    const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
    if (expected !== signature) {
      logger.warn('Razorpay webhook signature mismatch — rejecting');
      return errorResponse(res, 400, 'Invalid signature');
    }

    const { event, payload } = req.body || {};
    if (event !== 'qr_code.credited') {
      // Every other event type (payment.captured, order.paid, etc.) is either handled by the
      // synchronous verify-on-checkout flow (verifyBookingPayment) or not something this app
      // acts on — ack anyway so Razorpay doesn't keep retrying an event it'll never need.
      return successResponse(res, 200, 'Event ignored');
    }

    const qrCodeId = payload?.qr_code?.entity?.id;
    if (!qrCodeId) return successResponse(res, 200, 'No qr_code id in payload');

    const trip = await TripModel.findByRazorpayQrCodeId(qrCodeId);
    if (!trip) {
      logger.warn(`Razorpay webhook: no trip found for qr_code ${qrCodeId}`);
      return successResponse(res, 200, 'No matching trip');
    }
    if (!['pending', 'partial'].includes(trip.booking_payment_status)) {
      // Already finalized — most likely the driver's own poll got there first. Idempotent no-op.
      return successResponse(res, 200, 'Already paid');
    }

    // Same finalize path getPaymentQrStatus's success branch uses, kept in sync deliberately.
    await finalizeTripPayment({ trip, mode: 'razorpay_qr', collectedByUserId: null, collectedByRole: null });
    await new RazorpayPaymentProvider().closeQrCode(qrCodeId);
    await TripModel.setRazorpayQrCode(trip.id, { qrCodeId, imageUrl: trip.razorpay_qr_image_url, status: 'closed' });

    logger.info(`Razorpay webhook: trip ${trip.id} payment confirmed via qr_code ${qrCodeId}`);
    return successResponse(res, 200, 'Payment confirmed');
  } catch (err) {
    next(err);
  }
};

module.exports = { razorpayWebhook };
