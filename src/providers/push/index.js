const FakePushProvider = require('./FakePushProvider');
const FirebasePushProvider = require('./FirebasePushProvider');

// PUSH_PROVIDER=fake (default) — logs only, no external calls, no credentials required.
// PUSH_PROVIDER=firebase — needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL,
// FIREBASE_PRIVATE_KEY set (see .env.example).
const getPushProvider = () => {
  switch (process.env.PUSH_PROVIDER) {
    case 'firebase':
      return new FirebasePushProvider();
    default:
      return new FakePushProvider();
  }
};

module.exports = { getPushProvider };
