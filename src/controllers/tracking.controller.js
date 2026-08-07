const BoltTrackingProvider = require('../providers/tracking/BoltTrackingProvider');
const { successResponse, errorResponse } = require('../utils/response');

const provider = new BoltTrackingProvider();

// ─── GET /api/tracking/devices ────────────────────────────────────────────────
// Admin only — the full device list is fleet-wide, not scoped to any one broker/driver.
const listDevices = async (req, res, next) => {
  try {
    const devices = await provider.getAllDevices();
    if (devices === null) return errorResponse(res, 502, 'Failed to fetch devices from the tracking provider');
    return successResponse(res, 200, 'Devices fetched', { devices });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/tracking/devices/name/:name ─────────────────────────────────────
const getDeviceByName = async (req, res, next) => {
  try {
    const device = await provider.getDeviceByName(req.params.name);
    if (!device) return errorResponse(res, 404, 'Device not found');
    return successResponse(res, 200, 'Device fetched', { device });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/tracking/devices/imei/:imei ─────────────────────────────────────
const getDeviceByImei = async (req, res, next) => {
  try {
    const device = await provider.getDeviceByImei(req.params.imei);
    if (!device) return errorResponse(res, 404, 'Device not found');
    return successResponse(res, 200, 'Device fetched', { device });
  } catch (err) {
    next(err);
  }
};

module.exports = { listDevices, getDeviceByName, getDeviceByImei };
