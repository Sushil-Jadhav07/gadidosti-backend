const BoltTrackingProvider = require('../providers/tracking/BoltTrackingProvider');
const TrackingLastKnownModel = require('../models/trackingLastKnown.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const provider = new BoltTrackingProvider();

// Best-effort cache warm — never blocks/fails the response over this, same "fire and forget"
// pattern NotificationModel.sendPush already uses for push delivery.
const cacheDevice = (device) => {
  if (!device?.deviceImei) return;
  TrackingLastKnownModel.upsert({
    deviceImei: device.deviceImei,
    deviceName: device.name,
    latitude: device.latitude,
    longitude: device.longitude,
    speed: device.speed,
    course: device.course,
    ignition: device.ignition,
    raw: device,
  }).catch((err) => logger.warn(`tracking_last_known upsert failed: ${err.message}`));
};

// Reshapes a cached row back into the same field names the live Bolt response uses, so the
// frontend (Tracking.jsx/TrackingDetail.jsx) doesn't need to branch on where the data came
// from — just check `source`/`lastSeenAt` to show the "last seen" fallback banner.
const projectCached = (row) => ({
  deviceImei: row.device_imei,
  name: row.device_name,
  latitude: row.latitude,
  longitude: row.longitude,
  speed: row.speed,
  course: row.course,
  ignition: row.ignition,
  status: 'offline',
  lastUpdate: row.recorded_at,
  ...(row.raw || {}),
  source: 'cached',
  lastSeenAt: row.recorded_at,
});

// ─── GET /api/tracking/devices ────────────────────────────────────────────────
// Admin only — the full device list is fleet-wide, not scoped to any one broker/driver.
const listDevices = async (req, res, next) => {
  try {
    const devices = await provider.getAllDevices();
    if (devices === null) {
      // Vendor call failed — fall back to whatever positions we've cached from earlier
      // successful polls, rather than showing nothing at all.
      const cached = await TrackingLastKnownModel.findAll();
      if (!cached.length) return errorResponse(res, 502, 'Failed to fetch devices from the tracking provider');
      return successResponse(res, 200, 'Devices fetched (cached — live tracking unavailable)', { devices: cached.map(projectCached), source: 'cached' });
    }
    devices.forEach(cacheDevice);
    return successResponse(res, 200, 'Devices fetched', { devices });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/tracking/devices/name/:name ─────────────────────────────────────
const getDeviceByName = async (req, res, next) => {
  try {
    const device = await provider.getDeviceByName(req.params.name);
    if (!device) {
      const cached = await TrackingLastKnownModel.findByName(req.params.name);
      if (!cached) return errorResponse(res, 404, 'Device not found');
      return successResponse(res, 200, 'Device fetched (cached — live tracking unavailable)', { device: projectCached(cached) });
    }
    cacheDevice(device);
    return successResponse(res, 200, 'Device fetched', { device });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/tracking/devices/imei/:imei ─────────────────────────────────────
const getDeviceByImei = async (req, res, next) => {
  try {
    const device = await provider.getDeviceByImei(req.params.imei);
    if (!device) {
      const cached = await TrackingLastKnownModel.findByImei(req.params.imei);
      if (!cached) return errorResponse(res, 404, 'Device not found');
      return successResponse(res, 200, 'Device fetched (cached — live tracking unavailable)', { device: projectCached(cached) });
    }
    cacheDevice(device);
    return successResponse(res, 200, 'Device fetched', { device });
  } catch (err) {
    next(err);
  }
};

module.exports = { listDevices, getDeviceByName, getDeviceByImei };
