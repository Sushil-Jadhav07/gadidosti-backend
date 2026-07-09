const TripModel = require('../models/trip.model');
const BookingModel = require('../models/booking.model');
const DriverProfileModel = require('../models/driverProfile.model');
const SettlementModel = require('../models/settlement.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// Subset of the booking status stepper that applies once a trip exists.
const TRIP_STEPS = ['confirmed', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

const projectTrip = (row, timeline) => ({
  id: row.id,
  bookingId: row.booking_id,
  status: row.status,
  broker: row.broker_name || null,
  brokerPhone: row.broker_phone || null,
  driverId: row.driver_id,
  driverName: row.driver_name || null,
  driverPhone: row.driver_phone || null,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  truckId: row.truck_id,
  truckReg: row.truck_reg || null,
  pickup: {
    location: row.pickup_address,
    address: row.pickup_address,
    contactPerson: row.pickup_contact_person,
    contactPhone: row.pickup_contact_phone,
    time: row.pickup_time,
    lat: row.pickup_lat,
    lng: row.pickup_lng,
  },
  drop: {
    location: row.drop_address,
    address: row.drop_address,
    contactPerson: row.drop_contact_person,
    contactPhone: row.drop_contact_phone,
    time: row.drop_time,
    lat: row.drop_lat,
    lng: row.drop_lng,
  },
  distance: row.distance,
  estimatedTime: row.estimated_time,
  cargo: {
    material: row.cargo_material,
    weight: row.cargo_weight,
    quantity: row.cargo_quantity,
    specialInstructions: row.cargo_special_instructions,
    value: row.cargo_value,
  },
  earnings: row.earnings,
  startedAt: row.started_at,
  currentLocation: { lat: row.current_lat, lng: row.current_lng },
  podUrl: row.pod_url,
  timeline: timeline.map((t) => ({ step: t.step, done: t.done, time: t.occurred_at })),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const assertCanView = (trip, user) => {
  if (user.role === 'admin') return true;
  if (user.role === 'broker') return trip.broker_id === user.id;
  if (user.role === 'driver') return trip.driver_id === user.id;
  return false;
};

const listTrips = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const result = await TripModel.findAll({
      role: req.user.role,
      userId: req.user.id,
      status,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
    });

    const trips = await Promise.all(result.trips.map(async (row) => {
      const timeline = await TripModel.getTimeline(row.id);
      return projectTrip(row, timeline);
    }));

    return successResponse(res, 200, 'Trips fetched', { ...result, trips });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/active ────────────────────────────────────────────────────
const getActiveTrip = async (req, res, next) => {
  try {
    const trip = await TripModel.findActiveByDriver(req.user.id);
    if (!trip) return successResponse(res, 200, 'No active trip', { trip: null });

    const timeline = await TripModel.getTimeline(trip.id);
    return successResponse(res, 200, 'Active trip fetched', { trip: projectTrip(trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/upcoming ───────────────────────────────────────────────────
// The driver's next assigned trip that hasn't started yet (status still 'confirmed').
// Distinct from /trips/active, which only ever returns one in-progress trip at a time —
// this lets the UI show "what's next" without it duplicating the active trip card.
const getUpcomingTrip = async (req, res, next) => {
  try {
    const active = await TripModel.findActiveByDriver(req.user.id);
    const trip = await TripModel.findUpcomingByDriver(req.user.id, active?.id);
    if (!trip) return successResponse(res, 200, 'No upcoming trip', { trip: null });

    const timeline = await TripModel.getTimeline(trip.id);
    return successResponse(res, 200, 'Upcoming trip fetched', { trip: projectTrip(trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trips/:id ───────────────────────────────────────────────────────
const getTrip = async (req, res, next) => {
  try {
    const trip = await TripModel.findById(req.params.id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (!assertCanView(trip, req.user)) return errorResponse(res, 403, 'You do not have access to this trip');

    const timeline = await TripModel.getTimeline(trip.id);
    return successResponse(res, 200, 'Trip fetched', { trip: projectTrip(trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/trips/:id/status ──────────────────────────────────────────────
const updateTripStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (!assertCanView(trip, req.user)) return errorResponse(res, 403, 'You do not have access to this trip');

    await TripModel.updateStatus(id, status);
    const stepIndex = TRIP_STEPS.indexOf(status);
    await TripModel.addTimelineStep(id, { step: status, position: stepIndex >= 0 ? stepIndex : 99 });

    // Mirror the same status/step onto the parent booking so the client's tracker stays in sync.
    const bookingStepIndex = ['pending', 'confirmed', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'].indexOf(status);
    await BookingModel.advanceStatus(trip.booking_id, { status, currentStep: bookingStepIndex >= 0 ? bookingStepIndex : undefined });
    await BookingModel.addTimelineStep(trip.booking_id, { step: status, position: bookingStepIndex >= 0 ? bookingStepIndex : 99 });

    if (['delivered', 'completed'].includes(status)) {
      if (trip.driver_id) await DriverProfileModel.incrementTotalTrips(trip.driver_id);

      const booking = await BookingModel.findById(trip.booking_id);
      await SettlementModel.create({
        bookingId: trip.booking_id,
        brokerId: trip.broker_id,
        driverId: trip.driver_id,
        amount: booking.amount || 0,
        platformFee: booking.platform_fee || 0,
      });

      if (trip.driver_id) {
        await NotificationModel.create({
          userId: trip.driver_id,
          title: 'Trip Completed',
          message: 'Your trip has been marked delivered. Settlement is pending processing.',
          type: 'payment',
          meta: { trip_id: id },
        });
      }
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_STATUS_UPDATED',
      entity: 'trips',
      entityId: id,
      meta: { new_status: status },
      ipAddress: req.ip,
    });

    logger.info(`Trip ${id} status -> ${status} by ${req.user.id}`);
    const full = await TripModel.findById(id);
    const timeline = await TripModel.getTimeline(id);
    return successResponse(res, 200, 'Trip status updated', { trip: projectTrip(full || trip, timeline) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/trips/:id/location ────────────────────────────────────────────
const updateTripLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { lat, lng } = req.body;

    const trip = await TripModel.findById(id);
    if (!trip) return errorResponse(res, 404, 'Trip not found');
    if (req.user.role === 'driver' && trip.driver_id !== req.user.id) return errorResponse(res, 403, 'Not your trip');

    const updated = await TripModel.updateLocation(id, { lat, lng });
    return successResponse(res, 200, 'Location updated', { currentLocation: { lat: updated.current_lat, lng: updated.current_lng } });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/trips/:id/pod ──────────────────────────────────────────────────
// Stub — no object storage configured, mirrors uploadKycDocument's pattern.
const uploadPod = async (req, res) => {
  return errorResponse(
    res,
    501,
    'Proof-of-delivery file upload is not configured yet. No storage provider (S3/Cloudinary) is set up.'
  );
};

module.exports = { listTrips, getActiveTrip, getUpcomingTrip, getTrip, updateTripStatus, updateTripLocation, uploadPod };
