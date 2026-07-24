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
 * @property {number} [durationMin]
 * @property {number} [durationInTrafficMin] - live-traffic ETA; equals durationMin when no real traffic data is available
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

  /**
   * Full driving route between two points, including an encoded polyline — for callers that
   * need more than a distance figure (e.g. drawing the route on a map). Optional: not every
   * provider can support this (FakeLocationProvider returns null), so callers must handle null.
   * @param {DistanceParams} params
   * @returns {Promise<{distanceKm: number, durationMin: number, polyline: string}|null>}
   */
  async getRoute(params) {
    return null;
  }
}

module.exports = LocationProvider;
