const FakePaymentProvider = require('./FakePaymentProvider');

// PAYMENT_PROVIDER=fake (default). To add Razorpay later:
//   const RazorpayPaymentProvider = require('./RazorpayPaymentProvider');
//   if (process.env.PAYMENT_PROVIDER === 'razorpay') return new RazorpayPaymentProvider();
const getPaymentProvider = () => {
  switch (process.env.PAYMENT_PROVIDER) {
    default:
      return new FakePaymentProvider();
  }
};

module.exports = { getPaymentProvider };
