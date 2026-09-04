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
}

module.exports = RazorpayPaymentProvider;
