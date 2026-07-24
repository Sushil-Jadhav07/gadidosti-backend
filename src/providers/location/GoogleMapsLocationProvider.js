const LocationProvider = require('./LocationProvider');
const logger = require('../../utils/logger');

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const DISTANCE_MATRIX_URL = 'https://maps.googleapis.com/maps/api/distancematrix/json';
const DIRECTIONS_URL = 'https://maps.googleapis.com/maps/api/directions/json';
const REQUEST_TIMEOUT_MS = 8000;

const getJson = async (url) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
};

class GoogleMapsLocationProvider extends LocationProvider {
  constructor() {
    super();
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
  }

  async geocode({ address }) {
    if (!address) return null;
    try {
      const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${this.apiKey}`;
      const data = await getJson(url);
      const result = data.results?.[0];
      if (data.status !== 'OK' || !result) {
        if (data.status !== 'ZERO_RESULTS') logger.warn(`Geocoding API: "${address}" -> ${data.status}${data.error_message ? ` (${data.error_message})` : ''}`);
        return null;
      }
      const { lat, lng } = result.geometry.location;
      return { lat, lng };
    } catch (err) {
      logger.error(`Geocoding API request failed for "${address}": ${err.message}`);
      return null;
    }
  }

  // Reverse geocode: coordinates -> a human-readable address. Not part of the base
  // LocationProvider interface (FakeLocationProvider has no equivalent, since it has no
  // real address data to reverse-lookup) — additive capability for callers that have it.
  async reverseGeocode({ lat, lng }) {
    if (lat == null || lng == null) return null;
    try {
      const url = `${GEOCODE_URL}?latlng=${lat},${lng}&key=${this.apiKey}`;
      const data = await getJson(url);
      const result = data.results?.[0];
      if (data.status !== 'OK' || !result) {
        if (data.status !== 'ZERO_RESULTS') logger.warn(`Reverse geocoding API: "${lat},${lng}" -> ${data.status}${data.error_message ? ` (${data.error_message})` : ''}`);
        return null;
      }
      return { address: result.formatted_address };
    } catch (err) {
      logger.error(`Reverse geocoding API request failed for "${lat},${lng}": ${err.message}`);
      return null;
    }
  }

  // Distance + duration between two points (city names or full addresses both work — the
  // API resolves free-text). Used by the pricing engine (config.controller.js's getDistance)
  // and Part Truck capacity/route matching.
  //
  // departure_time=now makes Google also return duration_in_traffic (current live-traffic
  // ETA) alongside the normal traffic-free duration — durationInTrafficMin/durationMin's
  // ratio is what PricingModel.estimate() uses to apply its traffic surge multiplier.
  async getDistance({ from, to }) {
    if (!from || !to) return null;
    try {
      const url = `${DISTANCE_MATRIX_URL}?origins=${encodeURIComponent(from)}&destinations=${encodeURIComponent(to)}&departure_time=now&key=${this.apiKey}`;
      const data = await getJson(url);
      const element = data.rows?.[0]?.elements?.[0];
      if (data.status !== 'OK' || !element || element.status !== 'OK') {
        logger.warn(`Distance Matrix API: "${from}" -> "${to}" => ${element?.status || data.status}${data.error_message ? ` (${data.error_message})` : ''}`);
        return null;
      }
      const durationMin = Math.round(element.duration.value / 60);
      // duration_in_traffic can be absent (e.g. transit_mode without traffic data) — fall
      // back to durationMin (ratio 1.0, no surge) rather than leaving it undefined.
      const durationInTrafficMin = element.duration_in_traffic
        ? Math.round(element.duration_in_traffic.value / 60)
        : durationMin;
      return {
        distanceKm: Math.round((element.distance.value / 1000) * 10) / 10,
        durationMin,
        durationInTrafficMin,
      };
    } catch (err) {
      logger.error(`Distance Matrix API request failed for "${from}" -> "${to}": ${err.message}`);
      return null;
    }
  }

  // Full driving route (turn-by-turn legs + an encoded overview polyline), not just a distance
  // figure. Not part of the base LocationProvider interface — frontends normally render routes
  // client-side via @react-google-maps/api's DirectionsService, so nothing calls this yet, but
  // it's available for any server-side use (e.g. precomputing a route once instead of per-viewer).
  async getRoute({ from, to }) {
    if (!from || !to) return null;
    try {
      const url = `${DIRECTIONS_URL}?origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}&key=${this.apiKey}`;
      const data = await getJson(url);
      const route = data.routes?.[0];
      const leg = route?.legs?.[0];
      if (data.status !== 'OK' || !route || !leg) {
        logger.warn(`Directions API: "${from}" -> "${to}" => ${data.status}${data.error_message ? ` (${data.error_message})` : ''}`);
        return null;
      }
      return {
        distanceKm: Math.round((leg.distance.value / 1000) * 10) / 10,
        durationMin: Math.round(leg.duration.value / 60),
        polyline: route.overview_polyline?.points || null,
      };
    } catch (err) {
      logger.error(`Directions API request failed for "${from}" -> "${to}": ${err.message}`);
      return null;
    }
  }
}

module.exports = GoogleMapsLocationProvider;
