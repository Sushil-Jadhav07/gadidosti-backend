const nodemailer = require('nodemailer');
const EmailProvider = require('./EmailProvider');
const logger = require('../../utils/logger');

// Real SMTP send via nodemailer — needs SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASSWORD/EMAIL_FROM
// set (see .env.example). Works with any standard SMTP provider (Gmail app password, SendGrid,
// Resend's SMTP relay, etc.) — no vendor-specific SDK, just the one transport.
class NodemailerEmailProvider extends EmailProvider {
  constructor() {
    super();
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }

  async send({ to, subject, html, text, attachments }) {
    try {
      const info = await this.transporter.sendMail({
        from: process.env.EMAIL_FROM || process.env.SMTP_USER,
        to,
        subject,
        html,
        text: text || html?.replace(/<[^>]+>/g, ''),
        attachments,
      });
      return { success: true, messageId: info.messageId };
    } catch (err) {
      logger.error(`NodemailerEmailProvider send failed for "${to}": ${err.message}`);
      return { success: false };
    }
  }
}

module.exports = NodemailerEmailProvider;
