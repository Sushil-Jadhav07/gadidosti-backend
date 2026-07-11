/**
 * @typedef {Object} SendParams
 * @property {string} phone
 * @property {string} message
 *
 * @typedef {Object} SendResult
 * @property {boolean} success
 */
class SmsProvider {
  /**
   * @param {SendParams} params
   * @returns {Promise<SendResult>}
   */
  async send(params) {
    throw new Error('SmsProvider.send not implemented');
  }
}

module.exports = SmsProvider;
