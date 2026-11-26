const BoltTrackingProvider = require('../providers/tracking/BoltTrackingProvider');
const TrackingLastKnownModel = require('../models/trackingLastKnown.model');
const TruckModel = require('../models/truck.model');
const GpsOwnerTruckModel = require('../models/gpsOwnerTruck.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const provider = new BoltTrackingProvider();

// null (unscoped) for admin/staff — they see every device, same as always. For a gps_owner,
// the set of IMEIs their granted trucks are actually linked to (see Users.jsx's Truck Access
// editor / GpsOwnerTruckModel) — a granted truck with no GPS device linked yet contributes
// nothing, same as any other unlinked truck.
const getAllowedImeis = async (req) => {
  if (req.user.role !== 'gps_owner') return null;
  const trucks = await GpsOwnerTruckModel.findGrantedTrucks(req.user.id);
  return new Set(trucks.map((t) => t.gps_device_imei).filter(Boolean));
};

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
// Admin/staff: the full device list, fleet-wide, unchanged. gps_owner: filtered down to only
// the devices linked to trucks an admin has explicitly granted them (see getAllowedImeis) — a
// gps_owner account sees nothing outside that set, not the whole fleet.
const listDevices = async (req, res, next) => {
  try {
    const allowedImeis = await getAllowedImeis(req);
    const devices = await provider.getAllDevices();
    if (devices === null) {
      // Vendor call failed — fall back to whatever positions we've cached from earlier
      // successful polls, rather than showing nothing at all.
      const cached = await TrackingLastKnownModel.findAll();
      if (!cached.length) return errorResponse(res, 502, 'Failed to fetch devices from the tracking provider');
      let withTrucks = await Promise.all(cached.map(projectCached).map(withLinkedTruck));
      if (allowedImeis) withTrucks = withTrucks.filter((d) => allowedImeis.has(d.deviceImei));
      return successResponse(res, 200, 'Devices fetched (cached — live tracking unavailable)', { devices: withTrucks, source: 'cached' });
    }
    devices.forEach(cacheDevice);
    let withTrucks = await Promise.all(devices.map(withLinkedTruck));
    if (allowedImeis) withTrucks = withTrucks.filter((d) => allowedImeis.has(d.deviceImei));
    return successResponse(res, 200, 'Devices fetched', { devices: withTrucks });
  } catch (err) {
    next(err);
  }
};

// A gps_owner guessing/typing a URL for an IMEI outside their granted set gets exactly the same
// 404 as a genuinely nonexistent device — never a 403, so this never confirms a device DOES
// exist on the fleet, just that it isn't reachable here.
const assertAllowed = async (req, device) => {
  if (!device) return device;
  const allowedImeis = await getAllowedImeis(req);
  if (allowedImeis && !allowedImeis.has(device.deviceImei)) return null;
  return device;
};

// ─── GET /api/tracking/devices/name/:name ─────────────────────────────────────
const getDeviceByName = async (req, res, next) => {
  try {
    const device = await provider.getDeviceByName(req.params.name);
    if (!device) {
      const cached = await TrackingLastKnownModel.findByName(req.params.name);
      if (!cached) return errorResponse(res, 404, 'Device not found');
      const withTruck = await assertAllowed(req, await withLinkedTruck(projectCached(cached)));
      if (!withTruck) return errorResponse(res, 404, 'Device not found');
      return successResponse(res, 200, 'Device fetched (cached — live tracking unavailable)', { device: withTruck });
    }
    cacheDevice(device);
    const withTruck = await assertAllowed(req, await withLinkedTruck(device));
    if (!withTruck) return errorResponse(res, 404, 'Device not found');
    return successResponse(res, 200, 'Device fetched', { device: withTruck });
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
      const withTruck = await assertAllowed(req, await withLinkedTruck(projectCached(cached)));
      if (!withTruck) return errorResponse(res, 404, 'Device not found');
      return successResponse(res, 200, 'Device fetched (cached — live tracking unavailable)', { device: withTruck });
    }
    cacheDevice(device);
    const withTruck = await assertAllowed(req, await withLinkedTruck(device));
    if (!withTruck) return errorResponse(res, 404, 'Device not found');
    return successResponse(res, 200, 'Device fetched', { device: withTruck });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/tracking/devices/:imei/link-truck ─────────────────────────────
// admin/staff only (see tracking.routes.js) — which physical device belongs to which truck is a
// fleet-management concern, distinct from which trucks a given gps_owner is allowed to SEE
// (that's GpsOwnerTruckModel/Users.jsx's Truck Access editor, admin-only too). A gps_owner that
// could freely relink devices would undermine its own visibility scoping.
// Links (or, with registration omitted/blank, unlinks) a GPS tracker IMEI to one of our own
// trucks by registration number — a plain text lookup rather than a full truck picker, since
// there's no separate truck-browsing page this flow needs to duplicate. The IMEI itself comes
// from the URL (the device the admin is already looking at), never hand-typed twice.
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
