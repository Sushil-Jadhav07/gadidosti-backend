/**
 * @typedef {Object} CreateOrderParams
 * @property {string} bookingId
 * @property {number} amount
 *
 * @typedef {Object} CreateOrderResult
 * @property {string} orderId
 *
 * @typedef {Object} VerifyPaymentParams
 * @property {string} orderId
 * @property {Object} [payload] - Provider-specific verification payload (e.g. signature, gateway payment id).
 *
 * @typedef {Object} VerifyPaymentResult
 * @property {boolean} success
 */
class PaymentProvider {
  /**
   * @param {CreateOrderParams} params
   * @returns {Promise<CreateOrderResult>}
   */
  async createOrder(params) {
    throw new Error('PaymentProvider.createOrder not implemented');
  }

  /**
   * @param {VerifyPaymentParams} params
   * @returns {Promise<VerifyPaymentResult>}
   */
  async verifyPayment(params) {
    throw new Error('PaymentProvider.verifyPayment not implemented');
  }
}

module.exports = PaymentProvider;
