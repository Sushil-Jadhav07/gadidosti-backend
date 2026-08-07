const EmailProvider = require('./EmailProvider');
const logger = require('../../utils/logger');

// No real SMTP wired up — logs what would have been sent and reports success, so every
// invoice.controller.js send path works identically in dev/test whether or not
// EMAIL_PROVIDER=smtp is configured.
class FakeEmailProvider extends EmailProvider {
  async send({ to, subject, attachments }) {
    const attachmentNote = attachments?.length ? ` with ${attachments.length} attachment(s) (${attachments.map((a) => a.filename).join(', ')})` : '';
    logger.info(`[FakeEmailProvider] Would email "${to}": "${subject}"${attachmentNote}`);
    return { success: true, messageId: 'fake' };
  }
}

module.exports = FakeEmailProvider;
