const FakeSmsProvider = require('./FakeSmsProvider');

// SMS_PROVIDER=fake (default). To add a real gateway later:
//   const TwilioSmsProvider = require('./TwilioSmsProvider');
//   if (process.env.SMS_PROVIDER === 'twilio') return new TwilioSmsProvider();
const getSmsProvider = () => {
  switch (process.env.SMS_PROVIDER) {
    default:
      return new FakeSmsProvider();
  }
};

module.exports = { getSmsProvider };
