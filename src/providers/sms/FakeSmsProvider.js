const SmsProvider = require('./SmsProvider');
const logger = require('../../utils/logger');

// No real SMS gateway is wired up yet — logs the message instead of sending it.
// Replicates the inline `logger.info` calls that used to live in auth.controller.js.
class FakeSmsProvider extends SmsProvider {
  async send({ phone, message }) {
    logger.info(`[FakeSmsProvider] SMS to ${phone}: ${message}`);
    return { success: true };
  }
}

module.exports = FakeSmsProvider;
