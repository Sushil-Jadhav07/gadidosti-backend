const FakeEmailProvider = require('./FakeEmailProvider');
const NodemailerEmailProvider = require('./NodemailerEmailProvider');

// EMAIL_PROVIDER=fake (default) — logs only, no external calls, no credentials required.
// EMAIL_PROVIDER=smtp — needs SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, EMAIL_FROM
// set (see .env.example).
const getEmailProvider = () => {
  switch (process.env.EMAIL_PROVIDER) {
    case 'smtp':
      return new NodemailerEmailProvider();
    default:
      return new FakeEmailProvider();
  }
};

module.exports = { getEmailProvider };
