const DriverRequestModel = require('../models/driverRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

const projectDriverRequest = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  driverId: row.driver_id,
  driverName: row.driver_name,
  driverPhone: row.driver_phone,
  brokerId: row.broker_id,
  brokerName: row.broker_name,
  brokerPhone: row.broker_phone,
  truckId: row.truck_id,
  truckReg: row.truck_reg,
  truckType: row.truck_type,
  truckCategory: row.truck_category,
  pickup: row.pickup,
  drop: row.drop_location,
  weight: row.weight ? `${row.weight} ${row.weight_unit || ''}`.trim() : null,
  amount: row.amount,
  status: row.status,
  // Whose turn it is to respond: while status='pending' and driverTimedOut is false, it's the
  // driver's; once driverTimedOut is true, it's the broker's; while 'countered', it's the client's.
  driverTimedOut: !!row.driver_timeout_at,
  // Full back-and-forth: [{ by: 'client'|'driver'|'broker', amount, note, at }], oldest first.
  offerHistory: row.offer_history || [],
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Only the driver may act while their window is open; only the broker may act once the
// timeout sweep has flagged it (driver_timeout_at set) — never both, never neither.
const assertCanRespond = (driverRequest, user) => {
  if (driverRequest.driver_timeout_at) return user.role === 'broker' && driverRequest.broker_id === user.id;
  return user.role === 'driver' && driverRequest.driver_id === user.id;
};

// ─── PATCH /api/driver-requests/:id/accept ────────────────────────────────────
const acceptDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (!assertCanRespond(driverRequest, req.user)) return errorResponse(res, 403, 'Not yours to respond to');
    if (driverRequest.status !== 'pending') return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const updated = await DriverRequestModel.respondentAccept(driverRequest.id);
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    await NotificationModel.create({
      userId: driverRequest.client_id,
      title: 'Driver Accepted',
      message: `${driverRequest.driver_name} accepted your request at ₹${driverRequest.amount} for booking ${driverRequest.booking_number}. Confirm to finalize.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
    });

    logger.info(`Driver request ${driverRequest.id} accepted by ${req.user.role} ${req.user.id}`);
    return successResponse(res, 200, 'Accepted — awaiting client confirmation', { request: projectDriverRequest(await DriverRequestModel.findById(driverRequest.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/driver-requests/:id/decline ───────────────────────────────────
const declineDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (!assertCanRespond(driverRequest, req.user)) return errorResponse(res, 403, 'Not yours to respond to');
    if (driverRequest.status !== 'pending') return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const updated = await DriverRequestModel.respondentDecline(driverRequest.id);
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    await NotificationModel.create({
      userId: driverRequest.client_id,
      title: 'Driver Unavailable',
      message: `This truck's driver declined your request for booking ${driverRequest.booking_number}. Pick another truck to try again.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
    });

    return successResponse(res, 200, 'Declined', { request: projectDriverRequest(await DriverRequestModel.findById(driverRequest.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/driver-requests/:id/counter ───────────────────────────────────
const counterDriverRequest = async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (!assertCanRespond(driverRequest, req.user)) return errorResponse(res, 403, 'Not yours to respond to');
    if (driverRequest.status !== 'pending') return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const updated = await DriverRequestModel.respondentCounter(driverRequest.id, { amount, note, actor: req.user.role });
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    await NotificationModel.create({
      userId: driverRequest.client_id,
      title: 'New Counter-Offer',
      message: `${req.user.role === 'broker' ? 'The broker' : 'The driver'} countered with ₹${amount} for booking ${driverRequest.booking_number}.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
    });

    return successResponse(res, 200, 'Counter-offer sent', { request: projectDriverRequest(await DriverRequestModel.findById(driverRequest.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/driver-requests/:id/client-accept ─────────────────────────────
// The confirmation step — unlike the broker-broadcast flow (where client-accept only picks a
// broker, and driver assignment is a separate later step), here the truck+driver are already
// known, so accepting finalizes the whole booking in one shot: status -> 'assigned' directly,
// truck/driver marked on_trip, and a trip record created — mirroring job.controller.js's
// assignDriver, minus the reassignment branch (this is always a first assignment, since a
// driver request only exists for a still-'pending' booking).
const clientAcceptDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (driverRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!['pending', 'countered'].includes(driverRequest.status)) return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const claimed = await DriverRequestModel.clientAcceptIfCountered(driverRequest.id);
    if (!claimed) return errorResponse(res, 400, 'Request is already actioned');

    const booking = await BookingModel.advanceStatusIfCurrent(driverRequest.booking_id, 'pending', {
      status: 'assigned',
      currentStep: STATUS_STEPS.indexOf('assigned'),
      brokerId: driverRequest.broker_id,
      driverId: driverRequest.driver_id,
      truckId: driverRequest.truck_id,
    });

    if (!booking) {
      // Booking moved on some other way (e.g. the broker-broadcast flow won it first) —
      // undo the accept so this request doesn't sit in a false 'accepted' state.
      await DriverRequestModel.respondentDecline(driverRequest.id).catch(() => {});
      return errorResponse(res, 409, 'This booking is no longer available');
    }

    if (claimed.amount != null && Number(booking.amount) !== Number(claimed.amount)) {
      await BookingModel.update(booking.id, { amount: claimed.amount });
    }

    await BookingModel.addTimelineStep(booking.id, { step: 'confirmed', position: 1 });
    await BookingModel.addTimelineStep(booking.id, { step: 'assigned', position: 2 });
    await DriverRequestModel.declineOthersForBooking(booking.id, driverRequest.id);

    await TruckModel.update(driverRequest.truck_id, { status: 'on_trip' });
    await DriverProfileModel.update(driverRequest.driver_id, { status: 'on_trip', truckId: driverRequest.truck_id });

    const trip = await TripModel.create({
      bookingId: booking.id,
      driverId: driverRequest.driver_id,
      brokerId: driverRequest.broker_id,
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

    await NotificationModel.create({
      userId: driverRequest.driver_id,
      title: 'Trip Confirmed',
      message: `Booking confirmed at ₹${claimed.amount}: ${booking.pickup_location} -> ${booking.drop_location}`,
      type: 'booking',
      meta: { booking_id: booking.id, trip_id: trip.id },
    });
    await NotificationModel.create({
      userId: driverRequest.broker_id,
      title: 'Trip Confirmed',
      message: `Your driver's trip was confirmed by the client at ₹${claimed.amount} (booking ${booking.booking_number}).`,
      type: 'booking',
      meta: { booking_id: booking.id, trip_id: trip.id },
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DRIVER_REQUEST_CLIENT_ACCEPTED',
      entity: 'driver_requests',
      entityId: driverRequest.id,
      meta: { booking_id: booking.id, amount: claimed.amount, trip_id: trip.id },
      ipAddress: req.ip,
    });

    logger.info(`Driver request ${driverRequest.id} confirmed by client ${req.user.id} — trip ${trip.id} created`);
    return successResponse(res, 200, 'Booking confirmed', { request: projectDriverRequest(await DriverRequestModel.findById(driverRequest.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/driver-requests/:id/client-reject ─────────────────────────────
// Booking itself is untouched (still 'pending') — the client is expected to go back to
// GET /api/vehicles/trucks/nearby and request a different truck.
const clientRejectDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (driverRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');

    const updated = await DriverRequestModel.clientRejectIfCountered(driverRequest.id);
    if (!updated) return errorResponse(res, 400, 'Request is not awaiting your response');

    const notifyUserId = driverRequest.driver_timeout_at ? driverRequest.broker_id : driverRequest.driver_id;
    await NotificationModel.create({
      userId: notifyUserId,
      title: 'Offer Declined',
      message: `The client declined the ₹${driverRequest.amount} offer for booking ${driverRequest.booking_number}.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id },
    });

    return successResponse(res, 200, 'Declined', { request: projectDriverRequest(await DriverRequestModel.findById(driverRequest.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/driver-requests/:id/client-counter ────────────────────────────
const clientCounterDriverRequest = async (req, res, next) => {
  try {
    const { amount, note } = req.body;
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (driverRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!['pending', 'countered'].includes(driverRequest.status)) return errorResponse(res, 400, `Request is not open for negotiation (${driverRequest.status})`);

    const updated = await DriverRequestModel.clientCounter(driverRequest.id, { amount, note });
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    // Countering resets driver_timeout_at to null (a fresh turn) — always notify the driver
    // first even if the broker had taken over, since the driver gets a fresh window.
    await NotificationModel.create({
      userId: driverRequest.driver_id,
      title: 'New Counter-Offer',
      message: `The client countered with ₹${amount} for booking ${driverRequest.booking_number}.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id },
    });

    return successResponse(res, 200, 'Counter-offer sent', { request: projectDriverRequest(await DriverRequestModel.findById(driverRequest.id)) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/driver-requests ─────────────────────────────────────────────────
// Driver -> requests addressed to them. Broker -> requests their driver timed out on
// (nothing to act on until then, so no point showing the rest of their fleet's inbox).
const listDriverRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const opts = { page: parseInt(page), limit: Math.min(parseInt(limit), 100) };

    const result = req.user.role === 'broker'
      ? await DriverRequestModel.findTimedOutByBroker(req.user.id, opts)
      : await DriverRequestModel.findByDriver(req.user.id, opts);

    return successResponse(res, 200, 'Driver requests fetched', { ...result, requests: result.requests.map(projectDriverRequest) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/driver-requests/:id ─────────────────────────────────────────────
const getDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');

    const canView = req.user.role === 'admin'
      || driverRequest.client_id === req.user.id
      || driverRequest.driver_id === req.user.id
      || driverRequest.broker_id === req.user.id;
    if (!canView) return errorResponse(res, 403, 'You do not have access to this request');

    return successResponse(res, 200, 'Driver request fetched', { request: projectDriverRequest(driverRequest) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  acceptDriverRequest, declineDriverRequest, counterDriverRequest,
  clientAcceptDriverRequest, clientRejectDriverRequest, clientCounterDriverRequest,
  listDriverRequests, getDriverRequest, projectDriverRequest,
};
