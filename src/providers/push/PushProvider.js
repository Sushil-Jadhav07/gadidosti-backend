/**
 * @typedef {Object} SendParams
 * @property {string[]} tokens - FCM device tokens to send to (one user can have several devices)
 * @property {string} title
 * @property {string} body
 * @property {Object} [data] - arbitrary string-keyed payload (e.g. { booking_id, type }) delivered alongside the notification
 *
 * @typedef {Object} SendResult
 * @property {number} successCount
 * @property {number} failureCount
 * @property {string[]} invalidTokens - tokens FCM reported as unregistered/invalid, for the caller to prune from device_tokens
 */
class PushProvider {
  /**
   * @param {SendParams} params
   * @returns {Promise<SendResult>}
   */
  async send(params) {
    throw new Error('PushProvider.send not implemented');
  }
}

module.exports = PushProvider;
