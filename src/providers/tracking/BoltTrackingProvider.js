const logger = require('../../utils/logger');

// Third-party GPS tracker feed (Roadcast Tech Solutions' "Track PULL API" — see the vendor's
// PDF spec, v1.3). One fixed external vendor, not a swappable provider like payment/push/
// storage, so this skips the Fake+index.js indirection those use — there's nothing to swap it
// with. Endpoint is pullapi-**s1** (not s2) — this was the actual cause of the "User not found"
// error previously flagged for follow-up with Roadcast; the credentials were fine, the account
// just isn't provisioned on the s2 server.
const BASE_URL = 'https://pullapi-s1.track360.co.in/api/v1/auth/pull_api';
const REQUEST_TIMEOUT_MS = 8000;

// The vendor's single-device lookups (by name or IMEI) return `data` as a one-element array
// instead of a plain object — "all devices" doesn't have this quirk, only these two.
const unwrapSingleDevice = (data) => (Array.isArray(data) ? data[0] || null : data || null);

const getJson = async (params) => {
  const url = `${BASE_URL}?${new URLSearchParams({
    username: process.env.BOLT_API_USERNAME,
    password: process.env.BOLT_API_PASSWORD,
    ...params,
  })}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
};

class BoltTrackingProvider {
  constructor() {
    if (!process.env.BOLT_API_USERNAME || !process.env.BOLT_API_PASSWORD) {
      logger.warn('BoltTrackingProvider: BOLT_API_USERNAME/BOLT_API_PASSWORD not configured — every call will fail');
    }
  }

  // All devices on the account.
  async getAllDevices() {
    try {
      const data = await getJson({});
      if (data.status !== 'success') {
        logger.warn(`Bolt pull API (all devices) returned status=${data.status}: ${data.message}`);
        return null;
      }
      return data.data || [];
    } catch (err) {
      logger.error(`Bolt pull API (all devices) request failed: ${err.message}`);
      return null;
    }
  }

  // Single device, looked up by tracker name (e.g. "DL1AA1100").
  async getDeviceByName(name) {
    if (!name) return null;
    try {
      const data = await getJson({ name });
      if (data.status !== 'success') {
        logger.warn(`Bolt pull API (device by name "${name}") returned status=${data.status}: ${data.message}`);
        return null;
      }
      // The vendor wraps even a single-device lookup's result in an array — unwrapped here, once,
      // so every caller (tracking.controller.js's withLinkedTruck/cacheDevice/assertAllowed, all
      // of which read device.deviceImei directly) gets a plain object or null, never an array
      // with no .deviceImei of its own. Previously left wrapped and silently tolerated by callers
      // that just skipped caching/truck-linking on a falsy .deviceImei — until assertAllowed
      // (added for gps_owner's device-access scoping) started treating that same falsy read as
      // "not in the allowed set," 404ing a device a gps_owner genuinely had been granted.
      return unwrapSingleDevice(data.data);
    } catch (err) {
      logger.error(`Bolt pull API (device by name "${name}") request failed: ${err.message}`);
      return null;
    }
  }

  // Single device, looked up by vehicle IMEI.
  async getDeviceByImei(imei) {
    if (!imei) return null;
    try {
      const data = await getJson({ deviceImei: imei });
      if (data.status !== 'success') {
        logger.warn(`Bolt pull API (device by IMEI "${imei}") returned status=${data.status}: ${data.message}`);
        return null;
      }
      return unwrapSingleDevice(data.data);
    } catch (err) {
      logger.error(`Bolt pull API (device by IMEI "${imei}") request failed: ${err.message}`);
      return null;
    }
  }
}

module.exports = BoltTrackingProvider;
