const { v4: uuidv4 } = require('uuid');
const PaymentProvider = require('./PaymentProvider');

// No real gateway is wired up yet — createOrder returns a mock order immediately and
// verifyPayment always succeeds. This replicates payBooking's previous inline behavior
// (mark paid unconditionally), just moved behind the PaymentProvider interface.
class FakePaymentProvider extends PaymentProvider {
  async createOrder({ bookingId, amount }) {
    return { orderId: `FAKE-ORDER-${bookingId}-${uuidv4().slice(0, 8)}`, amount, currency: 'INR', status: 'created' };
  }

  async verifyPayment({ orderId }) {
    return { success: true, orderId };
  }
}

module.exports = FakePaymentProvider;
