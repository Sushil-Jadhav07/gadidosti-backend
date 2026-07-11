/**
 * @typedef {Object} UploadParams
 * @property {Buffer} buffer
 * @property {string} filename
 * @property {string} [folder]
 *
 * @typedef {Object} UploadResult
 * @property {string} url
 */
class StorageProvider {
  /**
   * @param {UploadParams} params
   * @returns {Promise<UploadResult>}
   */
  async upload(params) {
    throw new Error('StorageProvider.upload not implemented');
  }
}

module.exports = StorageProvider;
