const JobRequestModel = require('../models/jobRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

// "2 min ago" style relative-time label — the broker JobRequests list reads this, not a raw timestamp.
const timeAgo = (date) => {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
};

const expiresInMinutes = (expiresAt) => {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 60000));
};

const projectJobRequest = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  pickup: row.pickup,
  drop: row.drop_location,
  distance: row.distance,
  truckType: row.truck_type,
  weight: row.weight ? `${row.weight} ${row.weight_unit || ''}`.trim() : null,
  amount: row.amount,
  status: row.status,
  expiresIn: expiresInMinutes(row.expires_at),
  timestamp: timeAgo(row.created_at),
});

// ─── GET /api/jobs/requests ───────────────────────────────────────────────────
const listJobRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;

    const result = await JobRequestModel.findByBroker(req.user.id, {
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Job requests fetched', { ...result, requests: result.requests.map(projectJobRequest) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/accept ──────────────────────────────────────
const acceptJobRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    if (jobRequest.status !== 'pending') return errorResponse(res, 400, `Job request is already ${jobRequest.status}`);
    if (expiresInMinutes(jobRequest.expires_at) === 0) {
      await JobRequestModel.setStatus(id, 'expired');
      return errorResponse(res, 400, 'This job request has expired');
    }

    // Broadcast bookings go to every broker at once — claim this specific request atomically
    // first, then the booking itself, so two brokers racing on the same booking can't both win.
    const claimed = await JobRequestModel.acceptIfPending(id);
    if (!claimed) return errorResponse(res, 400, 'Job request is already actioned');

    const booking = await BookingModel.advanceStatusIfCurrent(jobRequest.booking_id, 'pending', {
      status: 'confirmed',
      currentStep: 1,
      brokerId: req.user.id,
    });

    if (!booking) {
      // Another broker already got this booking first — undo our claim and bail out.
      await JobRequestModel.setStatus(id, 'declined');
      return errorResponse(res, 409, 'This booking has already been accepted by another broker');
    }

    await BookingModel.addTimelineStep(booking.id, { step: 'confirmed', position: 1 });
    await JobRequestModel.declineOthersForBooking(booking.id, id);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_ACCEPTED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: booking.id },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: booking.client_id,
      title: 'Booking Confirmed',
      message: `Your booking has been accepted by a broker and is now confirmed.`,
      type: 'booking',
      meta: { booking_id: booking.id },
    });

    logger.info(`Job request ${id} accepted by broker ${req.user.id}`);
    const full = await BookingModel.findById(booking.id);
    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, 'Job request accepted', { booking: {
      id: full.id,
      status: full.status,
      brokerId: full.broker_id,
      driverId: full.driver_id,
      truckId: full.truck_id,
      pickup: full.pickup_location,
      drop: full.drop_location,
      timeline: timeline.map((item) => item.step),
      currentStep: full.current_step,
    } });
  } catch (err) {
    next(err);
  }
};

const assignDriver = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { driverId, truckId } = req.body;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    if (jobRequest.status !== 'accepted') return errorResponse(res, 409, 'Job request must be accepted before assigning driver');

    const booking = await BookingModel.findById(jobRequest.booking_id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');

    const driverProfile = await DriverProfileModel.findById(driverId);
    if (!driverProfile || driverProfile.broker_id !== req.user.id) {
      return errorResponse(res, 404, 'Driver not found for this broker');
    }

    const truck = await TruckModel.findOwnedByBroker(truckId, req.user.id);
    if (!truck) return errorResponse(res, 404, 'Truck not found for this broker');
    // A truck already "on_trip" is only acceptable here if it's the same truck already
    // on this booking — i.e. keeping the truck while swapping the driver mid-trip.
    if (truck.status !== 'available' && truckId !== booking.truck_id) {
      return errorResponse(res, 409, 'Truck is not available');
    }

    // A trip already exists once this booking has been through assignDriver once before —
    // e.g. the broker is reassigning a different driver mid-trip after an incident, rather
    // than making the first assignment. trips.booking_id is UNIQUE, so this branch updates
    // the existing trip's driver instead of trying to insert a second one.
    const existingTrip = await TripModel.findByBookingId(booking.id);
    const isReassignment = !!existingTrip;

    if (isReassignment) {
      if (booking.driver_id && booking.driver_id !== driverId) {
        await DriverProfileModel.update(booking.driver_id, { status: 'available' });
      }
      if (booking.truck_id && booking.truck_id !== truckId) {
        await TruckModel.update(booking.truck_id, { status: 'available' });
      }
    }

    await BookingModel.advanceStatus(booking.id, {
      // Reassignment keeps the booking's current status/step — a driver swap shouldn't
      // regress an in-transit shipment back to "assigned" in the client's tracker.
      status: isReassignment ? booking.status : 'assigned',
      currentStep: isReassignment ? booking.current_step : STATUS_STEPS.indexOf('assigned'),
      brokerId: req.user.id,
      driverId,
      truckId,
    });
    await BookingModel.addTimelineStep(booking.id, {
      step: isReassignment ? 'driver_reassigned' : 'assigned',
      position: isReassignment ? 99 : 2,
    });

    await TruckModel.update(truckId, { status: 'on_trip' });
    await DriverProfileModel.update(driverId, { status: 'on_trip', truckId });

    let trip;
    if (isReassignment) {
      trip = await TripModel.reassignDriver(existingTrip.id, driverId);
    } else {
      trip = await TripModel.create({
        bookingId: booking.id,
        driverId,
        brokerId: req.user.id,
        pickupAddress: booking.pickup_location,
        pickupLat: booking.pickup_lat,
        pickupLng: booking.pickup_lng,
        dropAddress: booking.drop_location,
        dropLat: booking.drop_lat,
        dropLng: booking.drop_lng,
        distance: booking.distance,
        cargoMaterial: booking.material,
        cargoWeight: booking.weight,
        cargoQuantity: booking.quantity,
        cargoValue: booking.amount,
        earnings: booking.amount && booking.platform_fee ? booking.amount - booking.platform_fee : booking.amount,
      });

      await TripModel.addTimelineStep(trip.id, { step: 'Pickup', done: false, position: 0, occurredAt: null });
      await TripModel.addTimelineStep(trip.id, { step: 'In Transit', done: false, position: 1, occurredAt: null });
      await TripModel.addTimelineStep(trip.id, { step: 'Delivered', done: false, position: 2, occurredAt: null });
    }

    await NotificationModel.create({
      userId: driverId,
      title: isReassignment ? 'Trip Reassigned to You' : 'New Trip Assigned',
      message: isReassignment
        ? `You've been assigned to an in-progress trip: ${booking.pickup_location} -> ${booking.drop_location}`
        : `New trip assigned: ${booking.pickup_location} -> ${booking.drop_location}`,
      type: 'booking',
      meta: { booking_id: booking.id, trip_id: trip.id },
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: isReassignment ? 'JOB_DRIVER_REASSIGNED' : 'JOB_DRIVER_ASSIGNED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: booking.id, trip_id: trip.id, driver_id: driverId, truck_id: truckId },
      ipAddress: req.ip,
    });

    const full = await BookingModel.findById(booking.id);
    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, isReassignment ? 'Driver reassigned' : 'Driver assigned', { booking: {
      id: full.id,
      status: full.status,
      brokerId: full.broker_id,
      driverId: full.driver_id,
      truckId: full.truck_id,
      pickup: full.pickup_location,
      drop: full.drop_location,
      timeline: timeline.map((item) => item.step),
      currentStep: full.current_step,
    } });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/decline ─────────────────────────────────────
const declineJobRequest = async (req, res, next) => {
  try {
    const { id } = req.params;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    if (jobRequest.status !== 'pending') return errorResponse(res, 400, `Job request is already ${jobRequest.status}`);

    const updated = await JobRequestModel.setStatus(id, 'declined');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_DECLINED',
      entity: 'job_requests',
      entityId: id,
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Job request declined', { request: updated });
  } catch (err) {
    next(err);
  }
};

module.exports = { listJobRequests, acceptJobRequest, assignDriver, declineJobRequest };
