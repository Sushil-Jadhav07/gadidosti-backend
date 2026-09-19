const Razorpay = require('razorpay');
const crypto = require('crypto');
const PaymentProvider = require('./PaymentProvider');

// PAYMENT_PROVIDER=razorpay — needs RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET set (see .env.example).
// createOrder just opens a gateway order; nothing about the booking changes until verifyPayment
// confirms the signature (see booking.controller.js's createPaymentOrder/verifyBookingPayment,
// which are the only callers).
class RazorpayPaymentProvider extends PaymentProvider {
  constructor() {
    super();
    this.client = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
  }

  async createOrder({ bookingId, amount }) {
    // Razorpay wants the amount in paise (smallest currency unit), and receipt capped at 40
    // chars — booking UUIDs alone are 36, so this is already right at the limit.
    const order = await this.client.orders.create({
      amount: Math.round(Number(amount) * 100),
      currency: 'INR',
      receipt: `booking_${bookingId}`.slice(0, 40),
      notes: { bookingId },
    });
    return {
      orderId: order.id,
      amount,
      currency: order.currency,
      status: order.status,
      keyId: process.env.RAZORPAY_KEY_ID,
      provider: 'razorpay',
    };
  }

  // Razorpay's own recommended verification: HMAC-SHA256 of "order_id|payment_id" using the
  // key secret must match the razorpay_signature the checkout widget hands back — this is what
  // actually proves the payment is real and wasn't just a client claiming success. Never trust
  // a bare "it worked" from the frontend.
  async verifyPayment({ orderId, payload }) {
    const { razorpay_payment_id: paymentId, razorpay_signature: signature } = payload || {};
    if (!paymentId || !signature) return { success: false };

    const expected = crypto
      .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(`${orderId}|${paymentId}`)
      .digest('hex');

    return { success: expected === signature, orderId, paymentId };
  }

  // A driver-facing "scan and pay this exact amount" QR, verified by Razorpay itself — unlike
  // the raw UPI-intent QR (Personal/Company, see DeliveryCompletionFlow.jsx), which is a direct
  // peer-to-peer bank transfer Razorpay never sees, so there's nothing to independently confirm
  // beyond the driver's own tap. single_use + fixed_amount so it can only ever be paid once, for
  // exactly the amount due — no risk of a customer paying the wrong amount or the QR being
  // reused for a different trip. close_by gives it a hard expiry (Razorpay itself stops
  // accepting payment against it after that, regardless of whether anything here ever calls
  // closeQrCode) so a QR generated for one delivery can't quietly linger and be paid against
  // days later.
  async createQrCode({ amount, tripId, bookingNumber, closeByMinutes = 60 }) {
    const qr = await this.client.qrCode.create({
      type: 'upi_qr',
      name: `GadiDost — ${bookingNumber || tripId}`,
      usage: 'single_use',
      fixed_amount: true,
      payment_amount: Math.round(Number(amount) * 100),
      description: `Trip ${bookingNumber || tripId}`,
      close_by: Math.floor(Date.now() / 1000) + closeByMinutes * 60,
      notes: { trip_id: tripId },
    });
    return { id: qr.id, imageUrl: qr.image_url, status: qr.status };
  }

  // Polled on-demand (the driver's Payments step) as an immediate-feedback complement to the
  // qr_code.credited webhook, which is more reliable long-term but depends on the webhook URL
  // actually being configured on the Razorpay dashboard and has its own latency — polling this
  // needs neither. A QR is single_use, so any captured payment against it is the one that
  // matters; no need to sum/reconcile multiple.
  async fetchQrCodePayment(qrCodeId) {
    const payments = await this.client.qrCode.fetchPayments(qrCodeId);
    const paid = (payments.items || []).find((p) => p.status === 'captured');
    return paid ? { paid: true, paymentId: paid.id, amount: paid.amount / 100 } : { paid: false };
  }

  // Called once a trip's payment is confirmed some other way (cash, or this same QR already
  // paid) so the QR can't still be scanned and paid again — best-effort, a QR that's merely
  // past its close_by is already unusable on Razorpay's side regardless.
  async closeQrCode(qrCodeId) {
    try {
      await this.client.qrCode.close(qrCodeId);
    } catch {
      // Already closed/expired — nothing to do.
    }
  }
}

module.exports = RazorpayPaymentProvider;
