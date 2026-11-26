const BoltTrackingProvider = require('../providers/tracking/BoltTrackingProvider');
const TrackingLastKnownModel = require('../models/trackingLastKnown.model');
const TruckModel = require('../models/truck.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const provider = new BoltTrackingProvider();

// Merges "which of our trucks (if any) this device is linked to" onto a raw device reading —
// the Bolt vendor has no concept of our trucks at all, so this is the only place that join ever
// happens. Best-effort: a lookup failure just leaves the device without truck info rather than
// failing the whole request over it.
const withLinkedTruck = async (device) => {
  if (!device?.deviceImei) return device;
  try {
    const truck = await TruckModel.findByGpsImei(device.deviceImei);
    return { ...device, truckId: truck?.id || null, truckRegistration: truck?.registration || null };
  } catch {
    return { ...device, truckId: null, truckRegistration: null };
  }
};

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
// Admin/staff/gps_owner — the full device list is fleet-wide, not scoped to any one
// broker/driver (gps_owner is scoped to this page at all via requireAdminPage, not to a subset
// of devices within it — there's no concept of "my devices" vs "their devices", just one shared
// tracker fleet).
const listDevices = async (req, res, next) => {
  try {
    const devices = await provider.getAllDevices();
    if (devices === null) {
      // Vendor call failed — fall back to whatever positions we've cached from earlier
      // successful polls, rather than showing nothing at all.
      const cached = await TrackingLastKnownModel.findAll();
      if (!cached.length) return errorResponse(res, 502, 'Failed to fetch devices from the tracking provider');
      const withTrucks = await Promise.all(cached.map(projectCached).map(withLinkedTruck));
      return successResponse(res, 200, 'Devices fetched (cached — live tracking unavailable)', { devices: withTrucks, source: 'cached' });
    }
    devices.forEach(cacheDevice);
    const withTrucks = await Promise.all(devices.map(withLinkedTruck));
    return successResponse(res, 200, 'Devices fetched', { devices: withTrucks });
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
      return successResponse(res, 200, 'Device fetched (cached — live tracking unavailable)', { device: await withLinkedTruck(projectCached(cached)) });
    }
    cacheDevice(device);
    return successResponse(res, 200, 'Device fetched', { device: await withLinkedTruck(device) });
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
      return successResponse(res, 200, 'Device fetched (cached — live tracking unavailable)', { device: await withLinkedTruck(projectCached(cached)) });
    }
    cacheDevice(device);
    return successResponse(res, 200, 'Device fetched', { device: await withLinkedTruck(device) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/tracking/devices/:imei/link-truck ─────────────────────────────
// Links (or, with registration omitted/blank, unlinks) a GPS tracker IMEI to one of our own
// trucks by registration number — a plain text lookup rather than a full truck picker, since
// gps_owner never gets access to the Trucks page to browse one. The IMEI itself comes from the
// URL (the device the admin/gps_owner is already looking at), never hand-typed twice.
const linkDeviceToTruck = async (req, res, next) => {
  try {
    const { imei } = req.params;
    const { registration } = req.body;

    if (!registration || !String(registration).trim()) {
      const existing = await TruckModel.findByGpsImei(imei);
      if (!existing) return successResponse(res, 200, 'No truck was linked to this device', { truck: null });
      const truck = await TruckModel.setGpsDevice(existing.id, { imei: null, name: null });
      await AuditLogModel.log({
        userId: req.user.id, action: 'GPS_DEVICE_UNLINKED', entity: 'trucks', entityId: truck.id,
        meta: { imei }, ipAddress: req.ip,
      });
      return successResponse(res, 200, 'Device unlinked', { truck: null });
    }

    const truck = await TruckModel.findByRegistration(String(registration).trim());
    if (!truck) return errorResponse(res, 404, 'No truck found with this registration number');

    // A device can only ever be linked to one truck — if it's currently claimed by a different
    // one, that link is cleared first so the unique index never has to reject this outright with
    // an opaque DB error; the caller just sees the device move instead.
    const previousOwner = await TruckModel.findByGpsImei(imei);
    if (previousOwner && previousOwner.id !== truck.id) {
      await TruckModel.setGpsDevice(previousOwner.id, { imei: null, name: null });
    }

    const device = await provider.getDeviceByImei(imei);
    const updated = await TruckModel.setGpsDevice(truck.id, { imei, name: device?.name || null });

    await AuditLogModel.log({
      userId: req.user.id, action: 'GPS_DEVICE_LINKED', entity: 'trucks', entityId: truck.id,
      meta: { imei, registration: truck.registration }, ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Device linked to truck', {
      truck: { id: updated.id, registration: updated.registration },
    });
  } catch (err) {
    if (err.code === '23505') return errorResponse(res, 409, 'This device is already linked to another truck');
    next(err);
  }
};

module.exports = { listDevices, getDeviceByName, getDeviceByImei, linkDeviceToTruck };
