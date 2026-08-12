const logger = require('../../utils/logger');

// Third-party GPS tracker feed (Roadcast Tech Solutions' "Track PULL API" — see the vendor's
// PDF spec, v1.3). One fixed external vendor, not a swappable provider like payment/push/
// storage, so this skips the Fake+index.js indirection those use — there's nothing to swap it
// with. Endpoint is pullapi-**s1** (not s2) — this was the actual cause of the "User not found"
// error previously flagged for follow-up with Roadcast; the credentials were fine, the account
// just isn't provisioned on the s2 server.
const BASE_URL = 'https://pullapi-s1.track360.co.in/api/v1/auth/pull_api';
const REQUEST_TIMEOUT_MS = 8000;

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
      return data.data || null;
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
      return data.data || null;
    } catch (err) {
      logger.error(`Bolt pull API (device by IMEI "${imei}") request failed: ${err.message}`);
      return null;
    }
  }
}

module.exports = BoltTrackingProvider;
