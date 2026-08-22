const DriverRequestModel = require('../models/driverRequest.model');
const JobRequestModel = require('../models/jobRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { getIO } = require('../realtime/socket');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

// Each side gets at most this many counter-offers before they're limited to Accept/Decline —
// keeps negotiation from dragging out indefinitely. offer_history's very first entry is always
// the seed starting price (set once in DriverRequestModel.create), never a real counter action
// by either side, so it's excluded from both counts below.
const MAX_COUNTERS_PER_SIDE = 2;
const countClientCounters = (offerHistory) => (offerHistory || []).filter((entry, i) => i > 0 && entry.by === 'client').length;
const countRespondentCounters = (offerHistory) => (offerHistory || []).filter((entry, i) => i > 0 && entry.by !== 'client').length;

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
  // Set only for the broker-assign origin (broker picked this driver for an already-negotiated
  // job_requests booking) — null for the direct client-pick origin.
  jobRequestId: row.job_request_id || null,
  // Whose turn it is to respond: while status='pending' and driverTimedOut is false, it's the
  // driver's; once driverTimedOut is true, it's the broker's; while 'countered', it's the client's.
  driverTimedOut: !!row.driver_timeout_at,
  // Only meaningful while status='awaiting_confirmation' — 'client' means the client already
  // committed and it's the driver/broker's turn to confirm or decline; 'respondent' means the
  // reverse. Null otherwise.
  pendingConfirmationBy: row.pending_confirmation_by || null,
  // Full back-and-forth: [{ by: 'client'|'driver'|'broker', amount, note, at }], oldest first.
  offerHistory: row.offer_history || [],
  // Lets each frontend hide its own Counter button once its side has used up its counters,
  // without re-deriving the count itself — see MAX_COUNTERS_PER_SIDE above.
  clientCountersUsed: countClientCounters(row.offer_history),
  respondentCountersUsed: countRespondentCounters(row.offer_history),
  maxCountersPerSide: MAX_COUNTERS_PER_SIDE,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// Pushes the fresh request straight to a specific user's socket (see socket.js's auto-joined
// `user:${id}` room) — same recipients as whichever NotificationModel.create call sits next
// to each call site, so the UI updates live instead of waiting on the next poll.
const emitDriverRequestUpdate = (userId, driverRequest) => {
  if (!userId || !driverRequest) return;
  getIO()?.to(`user:${userId}`).emit('driver-request-updated', projectDriverRequest(driverRequest));
};

// Only the driver may act while their window is open; only the broker may act once the
// timeout sweep has flagged it (driver_timeout_at set) — never both, never neither.
const assertCanRespond = (driverRequest, user) => {
  if (driverRequest.driver_timeout_at) return user.role === 'broker' && driverRequest.broker_id === user.id;
  return user.role === 'driver' && driverRequest.driver_id === user.id;
};

// Locks the truck/driver, creates the trip, and mirrors the status onto the parent booking —
// shared between acceptDriverRequest (driver/broker agrees to the client's current asking
// price) and clientAcceptDriverRequest (client agrees to the driver/broker's counter-offer).
// Either direction is "both sides have now agreed on a price," so both finalize the booking
// the same way — there's no reason to require a second explicit confirmation once that's true.
// Returns null if the booking moved on some other way in the meantime (caller must undo the
// accept it just made).
const finalizeDriverRequest = async (driverRequest, amount) => {
  const fromStatus = driverRequest.job_request_id ? 'confirmed' : 'pending';
  const booking = await BookingModel.advanceStatusIfCurrent(driverRequest.booking_id, fromStatus, {
    status: 'assigned',
    currentStep: STATUS_STEPS.indexOf('assigned'),
    brokerId: driverRequest.broker_id,
    driverId: driverRequest.driver_id,
    truckId: driverRequest.truck_id,
  });
  if (!booking) return null;

  if (amount != null && Number(booking.amount) !== Number(amount)) {
    await BookingModel.update(booking.id, { amount });
  }

  await BookingModel.addTimelineStep(booking.id, { step: 'confirmed', position: 1 });
  await BookingModel.addTimelineStep(booking.id, { step: 'assigned', position: 2 });
  await DriverRequestModel.declineOthersForBooking(booking.id, driverRequest.id);
  // This booking was won through the direct client-pick flow, not the broker-broadcast one —
  // every job_requests row ever fanned out to brokers for it (potentially many, since every
  // eligible broker gets one on booking creation) is now stale and would otherwise sit
  // 'pending' forever in each of those brokers' inboxes.
  await JobRequestModel.declineAllForBooking(booking.id);

  await TruckModel.update(driverRequest.truck_id, { status: 'on_trip' });
  await DriverProfileModel.update(driverRequest.driver_id, { status: 'on_trip', truckId: driverRequest.truck_id });

  // Ordered sequence of every stop this trip visits — pickup, any extra loading/unloading
  // points the client added at booking time (bookings.loading_locations/unloading_locations,
  // dormant until now), and the final drop. Built once here so it never drifts from the
  // booking; the driver app only shows a checklist when there are loading/unloading entries,
  // so a booking with none of those produces the same [pickup, drop] shape trips always had.
  const stops = [
    { type: 'pickup', location: booking.pickup_location, lat: booking.pickup_lat, lng: booking.pickup_lng, status: 'pending', completedAt: null },
    ...(booking.loading_locations || []).map((s) => ({ type: 'loading', location: s.location, lat: s.lat, lng: s.lng, status: 'pending', completedAt: null })),
    ...(booking.unloading_locations || []).map((s) => ({ type: 'unloading', location: s.location, lat: s.lat, lng: s.lng, status: 'pending', completedAt: null })),
    { type: 'drop', location: booking.drop_location, lat: booking.drop_lat, lng: booking.drop_lng, status: 'pending', completedAt: null },
  ];

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
    stops,
  });
  await TripModel.addTimelineStep(trip.id, { step: 'Pickup', done: false, position: 0, occurredAt: null });
  await TripModel.addTimelineStep(trip.id, { step: 'In Transit', done: false, position: 1, occurredAt: null });
  await TripModel.addTimelineStep(trip.id, { step: 'Delivered', done: false, position: 2, occurredAt: null });

  return { booking, trip };
};

// ─── PATCH /api/driver-requests/:id/accept ────────────────────────────────────
// Driver (or broker, once the driver's timed out) agreeing to the client's current asking
// price. Mutual-confirmation: this is a dual-purpose CAS (DriverRequestModel.respondentAccept)
// — if the client hasn't already committed, this call only commits the respondent's own side
// (status -> 'awaiting_confirmation') and the booking is NOT finalized yet; the client must
// separately confirm via client-accept. If the client had already committed first, this call
// IS that second, finalizing confirmation, and the trip is created immediately.
const acceptDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (!assertCanRespond(driverRequest, req.user)) return errorResponse(res, 403, 'Not yours to respond to');
    const canActNow = driverRequest.status === 'pending'
      || (driverRequest.status === 'awaiting_confirmation' && driverRequest.pending_confirmation_by === 'client');
    if (!canActNow) return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const updated = await DriverRequestModel.respondentAccept(driverRequest.id);
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    if (updated.status === 'awaiting_confirmation') {
      // First mover — nothing is finalized yet. Notify the client that it's their turn.
      await NotificationModel.create({
        userId: driverRequest.client_id,
        title: 'Driver Accepted — Please Confirm',
        message: `${driverRequest.driver_name || 'The driver'} accepted your request at ₹${updated.amount} for booking ${driverRequest.booking_number}. Confirm to finalize.`,
        type: 'booking',
        meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
      });
      const fresh = await DriverRequestModel.findById(driverRequest.id);
      emitDriverRequestUpdate(driverRequest.client_id, fresh);
      logger.info(`Driver request ${driverRequest.id} accepted by ${req.user.role} ${req.user.id} — awaiting client confirmation`);
      return successResponse(res, 200, 'Accepted — waiting for the client to confirm', { request: projectDriverRequest(fresh) });
    }

    const result = await finalizeDriverRequest(updated, updated.amount);
    if (!result) {
      // Booking moved on some other way (e.g. the broker-broadcast flow won it first) —
      // undo the accept so this request doesn't sit in a false 'accepted' state. Must CAS
      // from 'accepted' (rollbackAccepted), not 'pending' — the row is already 'accepted' here.
      await DriverRequestModel.rollbackAccepted(driverRequest.id).catch(() => {});
      return errorResponse(res, 409, 'This booking is no longer available');
    }
    const { trip } = result;

    await NotificationModel.create({
      userId: driverRequest.client_id,
      title: 'Trip Confirmed',
      message: `${driverRequest.driver_name} confirmed your request at ₹${updated.amount} for booking ${driverRequest.booking_number}.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id, trip_id: trip.id },
    });

    // Notify whichever of driver/broker didn't act — the other one doesn't otherwise learn
    // this happened (e.g. broker accepted on a timed-out driver's behalf, or vice versa).
    const otherPartyId = req.user.id === driverRequest.driver_id ? driverRequest.broker_id : driverRequest.driver_id;
    if (otherPartyId && otherPartyId !== req.user.id) {
      await NotificationModel.create({
        userId: otherPartyId,
        title: 'Trip Confirmed',
        message: `The trip for booking ${driverRequest.booking_number} was confirmed at ₹${updated.amount}.`,
        type: 'booking',
        meta: { booking_id: driverRequest.booking_id, trip_id: trip.id },
      });
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DRIVER_REQUEST_ACCEPTED',
      entity: 'driver_requests',
      entityId: driverRequest.id,
      meta: { booking_id: driverRequest.booking_id, amount: updated.amount, trip_id: trip.id },
      ipAddress: req.ip,
    });

    const fresh = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestUpdate(driverRequest.client_id, fresh);
    if (otherPartyId && otherPartyId !== req.user.id) emitDriverRequestUpdate(otherPartyId, fresh);

    logger.info(`Driver request ${driverRequest.id} accepted by ${req.user.role} ${req.user.id} — trip ${trip.id} created`);
    return successResponse(res, 200, 'Accepted — booking confirmed', { request: projectDriverRequest(fresh) });
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
    const canActNow = driverRequest.status === 'pending'
      || (driverRequest.status === 'awaiting_confirmation' && driverRequest.pending_confirmation_by === 'client');
    if (!canActNow) return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const updated = await DriverRequestModel.respondentDecline(driverRequest.id);
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    // Broker-assign origin: the broker picked this driver, not the client — so the broker
    // needs to try someone else from their fleet, not the client "picking another truck"
    // (they never picked a truck in this flow to begin with).
    const notifyUserId = driverRequest.job_request_id ? driverRequest.broker_id : driverRequest.client_id;
    if (driverRequest.job_request_id) {
      await NotificationModel.create({
        userId: driverRequest.broker_id,
        title: 'Driver Declined Assignment',
        message: `The driver declined the assignment for booking ${driverRequest.booking_number}. Assign a different driver from your fleet.`,
        type: 'booking',
        meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
      });
    } else {
      await NotificationModel.create({
        userId: driverRequest.client_id,
        title: 'Driver Unavailable',
        message: `This truck's driver declined your request for booking ${driverRequest.booking_number}. Pick another truck to try again.`,
        type: 'booking',
        meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
      });
    }

    const fresh = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestUpdate(notifyUserId, fresh);

    return successResponse(res, 200, 'Declined', { request: projectDriverRequest(fresh) });
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
    if (countRespondentCounters(driverRequest.offer_history) >= MAX_COUNTERS_PER_SIDE) {
      return errorResponse(res, 400, `You've reached the limit of ${MAX_COUNTERS_PER_SIDE} counter-offers — please accept or decline instead`);
    }

    const updated = await DriverRequestModel.respondentCounter(driverRequest.id, { amount, note, actor: req.user.role });
    if (!updated) return errorResponse(res, 400, 'Request is already actioned');

    await NotificationModel.create({
      userId: driverRequest.client_id,
      title: 'New Counter-Offer',
      message: `${req.user.role === 'broker' ? 'The broker' : 'The driver'} countered with ₹${amount} for booking ${driverRequest.booking_number}.`,
      type: 'booking',
      meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
    });

    const fresh = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestUpdate(driverRequest.client_id, fresh);

    return successResponse(res, 200, 'Counter-offer sent', { request: projectDriverRequest(fresh) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/driver-requests/:id/client-accept ─────────────────────────────
// Mutual-confirmation, same dual-purpose CAS pattern as acceptDriverRequest above
// (DriverRequestModel.clientAcceptIfCountered): if the driver/broker hasn't already committed,
// this only commits the client's own side (status -> 'awaiting_confirmation') and does NOT
// finalize anything yet. Only once BOTH sides have accepted does this finalize the whole
// booking in one shot: status -> 'assigned', truck/driver marked on_trip, trip record created —
// mirroring job.controller.js's assignDriver, minus the reassignment branch (this is always a
// first assignment, since a driver request only exists for a still-'pending' booking).
const clientAcceptDriverRequest = async (req, res, next) => {
  try {
    const driverRequest = await DriverRequestModel.findById(req.params.id);
    if (!driverRequest) return errorResponse(res, 404, 'Driver request not found');
    if (driverRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    const canActNow = ['pending', 'countered'].includes(driverRequest.status)
      || (driverRequest.status === 'awaiting_confirmation' && driverRequest.pending_confirmation_by === 'respondent');
    if (!canActNow) return errorResponse(res, 400, `Request is not awaiting your response (${driverRequest.status})`);

    const claimed = await DriverRequestModel.clientAcceptIfCountered(driverRequest.id);
    if (!claimed) return errorResponse(res, 400, 'Request is already actioned');

    if (claimed.status === 'awaiting_confirmation') {
      // First mover — nothing is finalized yet. Notify the driver/broker that it's their turn.
      await NotificationModel.create({
        userId: driverRequest.driver_id,
        title: 'Client Accepted — Please Confirm',
        message: `The client accepted at ₹${claimed.amount} for booking ${driverRequest.booking_number}. Confirm to finalize.`,
        type: 'booking',
        meta: { booking_id: driverRequest.booking_id, driver_request_id: driverRequest.id },
      });
      const fresh = await DriverRequestModel.findById(driverRequest.id);
      emitDriverRequestUpdate(driverRequest.driver_id, fresh);
      emitDriverRequestUpdate(driverRequest.broker_id, fresh);
      logger.info(`Driver request ${driverRequest.id} accepted by client ${req.user.id} — awaiting driver confirmation`);
      return successResponse(res, 200, 'Accepted — waiting for the driver to confirm', { request: projectDriverRequest(fresh) });
    }

    const result = await finalizeDriverRequest(claimed, claimed.amount);
    if (!result) {
      // Booking moved on some other way (e.g. the broker-broadcast flow won it first) —
      // undo the accept so this request doesn't sit in a false 'accepted' state. Must CAS
      // from 'accepted' (rollbackAccepted), not 'pending' — the row is already 'accepted' here.
      await DriverRequestModel.rollbackAccepted(driverRequest.id).catch(() => {});
      return errorResponse(res, 409, 'This booking is no longer available');
    }
    const { booking, trip } = result;

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

    const fresh = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestUpdate(driverRequest.driver_id, fresh);
    emitDriverRequestUpdate(driverRequest.broker_id, fresh);

    logger.info(`Driver request ${driverRequest.id} confirmed by client ${req.user.id} — trip ${trip.id} created`);
    return successResponse(res, 200, 'Booking confirmed', { request: projectDriverRequest(fresh) });
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

    const fresh = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestUpdate(notifyUserId, fresh);

    return successResponse(res, 200, 'Declined', { request: projectDriverRequest(fresh) });
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
    if (countClientCounters(driverRequest.offer_history) >= MAX_COUNTERS_PER_SIDE) {
      return errorResponse(res, 400, `You've reached the limit of ${MAX_COUNTERS_PER_SIDE} counter-offers — please accept or find another driver instead`);
    }

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

    const fresh = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestUpdate(driverRequest.driver_id, fresh);

    return successResponse(res, 200, 'Counter-offer sent', { request: projectDriverRequest(fresh) });
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

// ─── GET /api/driver-requests/booking/:bookingId ──────────────────────────────
// Lets a client discover a driver_request they didn't create themselves — the broker-assign
// origin (job_request_id set) is created by the broker via job.controller.js's assignDriver,
// so the client has no id to look it up by otherwise (unlike the direct client-pick origin,
// where the client already has the id from their own POST /request-truck response).
const getDriverRequestForBooking = async (req, res, next) => {
  try {
    const requests = await DriverRequestModel.findByBookingId(req.params.bookingId);
    const driverRequest = requests[0] || null;
    if (!driverRequest) return errorResponse(res, 404, 'No driver request found for this booking');

    const canView = req.user.role === 'admin'
      || driverRequest.client_id === req.user.id
      || driverRequest.driver_id === req.user.id
      || driverRequest.broker_id === req.user.id;
    if (!canView) return errorResponse(res, 403, 'You do not have access to this booking');

    return successResponse(res, 200, 'Driver request fetched', { request: projectDriverRequest(driverRequest) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  acceptDriverRequest, declineDriverRequest, counterDriverRequest,
  clientAcceptDriverRequest, clientRejectDriverRequest, clientCounterDriverRequest,
  listDriverRequests, getDriverRequest, getDriverRequestForBooking,
  projectDriverRequest, emitDriverRequestUpdate,
  MAX_COUNTERS_PER_SIDE, countClientCounters, countRespondentCounters,
};
