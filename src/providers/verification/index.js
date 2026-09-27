const FakeVerificationProvider = require('./FakeVerificationProvider');
const CashfreeVerificationProvider = require('./CashfreeVerificationProvider');

// VERIFICATION_PROVIDER=fake (default, no external credentials needed) or =cashfree (needs
// CASHFREE_VERIFICATION_CLIENT_ID + CASHFREE_VERIFICATION_CLIENT_SECRET in .env — see
// .env.example). Same selection pattern as getPaymentProvider/getStorageProvider.
const getVerificationProvider = () => {
  switch (process.env.VERIFICATION_PROVIDER) {
    case 'cashfree':
      return new CashfreeVerificationProvider();
    default:
      return new FakeVerificationProvider();
  }
};

module.exports = { getVerificationProvider };
