/**
 * @typedef {Object} EmailAttachment
 * @property {string} filename
 * @property {Buffer} content
 * @property {string} [contentType]
 *
 * @typedef {Object} SendParams
 * @property {string} to
 * @property {string} subject
 * @property {string} [html]
 * @property {string} [text]
 * @property {EmailAttachment[]} [attachments]
 *
 * @typedef {Object} SendResult
 * @property {boolean} success
 * @property {string} [messageId]
 */
class EmailProvider {
  /**
   * @param {SendParams} params
   * @returns {Promise<SendResult>}
   */
  async send(params) {
    throw new Error('EmailProvider.send not implemented');
  }
}

module.exports = EmailProvider;
