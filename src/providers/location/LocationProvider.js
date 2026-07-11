/**
 * @typedef {Object} GeocodeParams
 * @property {string} address
 *
 * @typedef {Object} GeocodeResult
 * @property {number} lat
 * @property {number} lng
 *
 * @typedef {Object} DistanceParams
 * @property {string} from
 * @property {string} to
 *
 * @typedef {Object} DistanceResult
 * @property {number} distanceKm
 */
class LocationProvider {
  /**
   * @param {GeocodeParams} params
   * @returns {Promise<GeocodeResult|null>}
   */
  async geocode(params) {
    throw new Error('LocationProvider.geocode not implemented');
  }

  /**
   * @param {DistanceParams} params
   * @returns {Promise<DistanceResult|null>}
   */
  async getDistance(params) {
    throw new Error('LocationProvider.getDistance not implemented');
  }
}

module.exports = LocationProvider;
