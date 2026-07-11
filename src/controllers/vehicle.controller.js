const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const projectTruck = (row) => ({
  id: row.id,
  brokerId: row.broker_id,
  driverId: row.driver_id,
  driver: row.driver_name || null,
  registration: row.registration,
  type: row.type,
  category: row.category,
  capacity: row.capacity,
  make: row.make,
  year: row.year,
  insuranceExpiry: row.insurance_expiry,
  status: row.status,
  lastTrip: row.last_trip || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const projectDriver = (row) => ({
  id: row.user_id,
  name: row.name,
  phone: row.phone,
  brokerId: row.broker_id,
  broker: row.broker_name || undefined,
  licenseNo: row.license_no,
  licenseExpiry: row.license_expiry,
  aadhaar: row.aadhaar,
  truckId: row.truck_id,
  truckReg: row.truck_reg || null,
  totalTrips: row.total_trips,
  avatar: row.avatar,
  status: row.status,
  kycStatus: row.kyc_status,
  currentLat: row.current_lat != null ? Number(row.current_lat) : null,
  currentLng: row.current_lng != null ? Number(row.current_lng) : null,
  lastLocationAt: row.last_location_at || null,
  distanceKm: row.distance_km != null ? Number(row.distance_km) : undefined,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// ─── TRUCKS ───────────────────────────────────────────────────────────────────

// POST /api/vehicles/trucks
const createTruck = async (req, res, next) => {
  try {
    const { driver_id, registration, type, category, capacity, make, year, insurance_expiry } = req.body;

    const existing = await TruckModel.findByRegistration(registration);
    if (existing) return errorResponse(res, 409, 'A truck with this registration already exists');

    const truck = await TruckModel.create({
      brokerId: req.user.id,
      driverId: driver_id,
      registration,
      type,
      category,
      capacity,
      make,
      year,
      insuranceExpiry: insurance_expiry,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRUCK_CREATED',
      entity: 'trucks',
      entityId: truck.id,
      meta: { registration },
      ipAddress: req.ip,
    });

    const full = await TruckModel.findById(truck.id);
    return successResponse(res, 201, 'Truck added', { truck: projectTruck(full) });
  } catch (err) {
    next(err);
  }
};

// GET /api/vehicles/trucks
const listTrucks = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const result = await TruckModel.findAll({
      role: req.user.role,
      brokerId: req.user.id,
      status,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Trucks fetched', { ...result, trucks: result.trucks.map(projectTruck) });
  } catch (err) {
    next(err);
  }
};

// GET /api/vehicles/trucks/:id
const getTruck = async (req, res, next) => {
  try {
    const truck = await TruckModel.findById(req.params.id);
    if (!truck) return errorResponse(res, 404, 'Truck not found');
    if (req.user.role === 'broker' && truck.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your truck');

    return successResponse(res, 200, 'Truck fetched', { truck: projectTruck(truck) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/vehicles/trucks/:id
const updateTruck = async (req, res, next) => {
  try {
    const truck = await TruckModel.findById(req.params.id);
    if (!truck) return errorResponse(res, 404, 'Truck not found');
    if (req.user.role === 'broker' && truck.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your truck');

    const { driver_id, type, category, capacity, make, year, insurance_expiry, status } = req.body;
    const updated = await TruckModel.update(req.params.id, {
      driverId: driver_id, type, category, capacity, make, year, insuranceExpiry: insurance_expiry, status,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRUCK_UPDATED',
      entity: 'trucks',
      entityId: req.params.id,
      meta: { fields: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    const full = await TruckModel.findById(updated.id);
    return successResponse(res, 200, 'Truck updated', { truck: projectTruck(full) });
  } catch (err) {
    next(err);
  }
};

// DELETE /api/vehicles/trucks/:id
// Hard delete — only allowed when no booking has ever referenced this truck,
// since booking history must stay intact for audit/earnings purposes.
const deleteTruck = async (req, res, next) => {
  try {
    const truck = await TruckModel.findById(req.params.id);
    if (!truck) return errorResponse(res, 404, 'Truck not found');
    if (req.user.role === 'broker' && truck.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your truck');

    const referenced = await TruckModel.isReferencedByBookings(req.params.id);
    if (referenced) return errorResponse(res, 400, 'Cannot delete a truck with booking history — set its status instead');

    await TruckModel.remove(req.params.id);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRUCK_DELETED',
      entity: 'trucks',
      entityId: req.params.id,
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Truck deleted');
  } catch (err) {
    next(err);
  }
};

// ─── DRIVERS ──────────────────────────────────────────────────────────────────

// GET /api/vehicles/drivers/lookup?phone=...
// Lets a broker find a driver's account by phone instead of needing their raw user ID
// before linking them via POST /api/vehicles/drivers.
const lookupDriverByPhone = async (req, res, next) => {
  try {
    const phone = String(req.query.phone || '').replace(/\D/g, '').slice(-10);
    if (phone.length !== 10) return errorResponse(res, 422, 'Enter a valid 10-digit phone number');

    const targetUser = await UserModel.findByPhonePublic(phone);
    if (!targetUser || targetUser.role !== 'driver') {
      return errorResponse(res, 404, 'No driver account found with this phone number');
    }

    if (await DriverProfileModel.exists(targetUser.id)) {
      return errorResponse(res, 409, 'This driver is already linked to a broker');
    }

    return successResponse(res, 200, 'Driver found', {
      driver: { id: targetUser.id, name: targetUser.name, phone: targetUser.phone, kycStatus: targetUser.kyc_status },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/vehicles/drivers
const createDriver = async (req, res, next) => {
  try {
    const { user_id, license_no, license_expiry, aadhaar, truck_id, avatar } = req.body;

    const targetUser = await UserModel.findById(user_id);
    if (!targetUser) return errorResponse(res, 404, 'User not found');
    if (targetUser.role !== 'driver') return errorResponse(res, 400, 'Target user must have the driver role');

    if (await DriverProfileModel.exists(user_id)) {
      return errorResponse(res, 409, 'This driver already has a profile');
    }

    const profile = await DriverProfileModel.create({
      userId: user_id,
      brokerId: req.user.id,
      licenseNo: license_no,
      licenseExpiry: license_expiry,
      aadhaar,
      truckId: truck_id,
      avatar,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DRIVER_PROFILE_CREATED',
      entity: 'driver_profiles',
      entityId: user_id,
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: user_id,
      title: 'Driver Profile Created',
      message: `You have been added as a driver by ${req.user.name}.`,
      type: 'general',
    });

    return successResponse(res, 201, 'Driver profile created', { driver: projectDriver(profile) });
  } catch (err) {
    next(err);
  }
};

// GET /api/vehicles/drivers
const listDrivers = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10, near_lat, near_lng, truck_type } = req.query;

    const result = await DriverProfileModel.findAll({
      role: req.user.role,
      brokerId: req.user.id,
      status,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
      nearLat: near_lat !== undefined ? parseFloat(near_lat) : undefined,
      nearLng: near_lng !== undefined ? parseFloat(near_lng) : undefined,
      truckType: truck_type,
    });

    return successResponse(res, 200, 'Drivers fetched', { ...result, drivers: result.drivers.map(projectDriver) });
  } catch (err) {
    next(err);
  }
};

// GET /api/vehicles/drivers/:id
const getDriver = async (req, res, next) => {
  try {
    const driver = await DriverProfileModel.findById(req.params.id);
    if (!driver) return errorResponse(res, 404, 'Driver profile not found');
    if (req.user.role === 'broker' && driver.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your driver');

    return successResponse(res, 200, 'Driver fetched', { driver: projectDriver(driver) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/vehicles/drivers/:id
const updateDriver = async (req, res, next) => {
  try {
    const driver = await DriverProfileModel.findById(req.params.id);
    if (!driver) return errorResponse(res, 404, 'Driver profile not found');
    if (req.user.role === 'broker' && driver.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your driver');

    const { license_no, license_expiry, aadhaar, truck_id, avatar, status } = req.body;
    const updated = await DriverProfileModel.update(req.params.id, {
      licenseNo: license_no, licenseExpiry: license_expiry, aadhaar, truckId: truck_id, avatar, status,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DRIVER_PROFILE_UPDATED',
      entity: 'driver_profiles',
      entityId: req.params.id,
      meta: { fields: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Driver updated', { driver: projectDriver(updated) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/vehicles/drivers/me/location
// Pinged periodically by the driver's own app while online, even before a trip starts.
const updateDriverLocation = async (req, res, next) => {
  try {
    const { lat, lng } = req.body;

    const updated = await DriverProfileModel.updateLocation(req.user.id, { lat, lng });
    if (!updated) return errorResponse(res, 404, 'Driver profile not found');

    return successResponse(res, 200, 'Location updated', {
      location: {
        lat: Number(updated.current_lat),
        lng: Number(updated.current_lng),
        lastLocationAt: updated.last_location_at,
      },
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createTruck, listTrucks, getTruck, updateTruck, deleteTruck,
  lookupDriverByPhone, createDriver, listDrivers, getDriver, updateDriver, updateDriverLocation,
};
