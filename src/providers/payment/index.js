const FakePaymentProvider = require('./FakePaymentProvider');
const RazorpayPaymentProvider = require('./RazorpayPaymentProvider');

// PAYMENT_PROVIDER=fake (default, no external credentials needed) or =razorpay (needs
// RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET in .env — see .env.example).
const getPaymentProvider = () => {
  switch (process.env.PAYMENT_PROVIDER) {
    case 'razorpay':
      return new RazorpayPaymentProvider();
    default:
      return new FakePaymentProvider();
  }
};

module.exports = { getPaymentProvider };
