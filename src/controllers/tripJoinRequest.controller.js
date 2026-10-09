const TripJoinRequestModel = require('../models/tripJoinRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const PricingModel = require('../models/pricing.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getIO } = require('../realtime/socket');

const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

// A generous radius so "is this still a valid match" (capacity + route-compatibility) is
// re-checked without the original search's own radius_km becoming a second, redundant reason
// for a 404/409 here — the client already implicitly agreed to the distance by picking this
// truck off the GET /vehicles/trucks/nearby-on-trip results.
const REVALIDATION_RADIUS_KM = 1000;

const projectTripJoinRequest = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  clientId: row.client_id,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  targetTripId: row.target_trip_id,
  truckId: row.truck_id,
  truckReg: row.truck_reg,
  truckCategory: row.truck_category,
  driverId: row.driver_id,
  driverName: row.driver_name,
  driverPhone: row.driver_phone,
  brokerId: row.broker_id,
  brokerName: row.broker_name,
  brokerPhone: row.broker_phone,
  pickup: row.pickup,
  drop: row.drop_location,
  weight: row.weight ? `${row.weight} ${row.weight_unit || ''}`.trim() : null,
  amount: row.amount,
  status: row.status,
  driverTimedOut: !!row.driver_timeout_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const emitTripJoinRequestCreated = (userId, request) => {
  if (!userId || !request) return;
  getIO()?.to(`user:${userId}`).emit('trip-join-request-created', projectTripJoinRequest(request));
};

const emitTripJoinRequestUpdate = (userId, request) => {
  if (!userId || !request) return;
  getIO()?.to(`user:${userId}`).emit('trip-join-request-updated', projectTripJoinRequest(request));
};

// Same split as driver_requests' assertCanRespond — only the driver may act while their window
// is open; only the broker may act once the timeout sweep has flagged it.
const assertCanRespond = (request, user) => {
  if (request.driver_timeout_at) return user.role === 'broker' && request.broker_id === user.id;
  return user.role === 'driver' && request.driver_id === user.id;
};

// Re-confirms a target trip is still a genuinely valid part-load match for this booking right
// now — reuses TruckModel.findOnTripForPartLoad (the exact same matching logic the client's
// search used) rather than duplicating the capacity/cap/route checks ad hoc, so "still valid"
// always means the same thing it meant when the client searched. Returns the truck_id to use, or
// null if the match no longer holds (capacity taken by someone else, trip no longer active, cap
// hit, etc.).
const revalidateMatch = async (booking, targetTripId) => {
  const weightTons = TruckModel.normalizeWeightToTons(booking.weight, booking.weight_unit);
  const candidates = await TruckModel.findOnTripForPartLoad({
    pickupLat: booking.pickup_lat,
    pickupLng: booking.pickup_lng,
    dropLat: booking.drop_lat,
    dropLng: booking.drop_lng,
    weightTons,
    radiusKm: REVALIDATION_RADIUS_KM,
  });
  const match = candidates.find((c) => c.current_trip_id === targetTripId);
  return match ? match.truck_id : null;
};

// ─── POST /api/trip-join-requests ─────────────────────────────────────────────
// Client's entry point: they've already created a 'part' truck_category booking (search_mode
// 'part_load' — see booking.controller.js's broadcastBooking) and picked a specific on-trip
// truck off GET /vehicles/trucks/nearby-on-trip. This sends that truck's driver a request to
// take on the extra cargo.
const createTripJoinRequest = async (req, res, next) => {
  try {
    const { booking_id, target_trip_id } = req.body;

    const booking = await BookingModel.findById(booking_id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (booking.status !== 'pending') return errorResponse(res, 409, 'This booking is no longer pending');

    const existing = await TripJoinRequestModel.findByBookingId(booking_id);
    if (existing && existing.status !== 'declined') {
      return errorResponse(res, 409, 'A request is already pending for this booking');
    }

    const targetTrip = await TripModel.findById(target_trip_id);
    if (!targetTrip) return errorResponse(res, 404, 'Target trip not found');

    const truckId = await revalidateMatch(booking, target_trip_id);
    if (!truckId) {
      return errorResponse(res, 409, 'This truck can no longer accept this load — its capacity or route may have changed. Please search again.');
    }

    const request = await TripJoinRequestModel.create({
      bookingId: booking.id,
      targetTripId: target_trip_id,
      truckId,
      driverId: targetTrip.driver_id,
      brokerId: targetTrip.broker_id,
      amount: booking.amount,
    });

    await NotificationModel.create({
      userId: targetTrip.driver_id,
      title: 'Part-Load Request',
      message: `A client wants to add a load to your current trip: ${booking.pickup_location} -> ${booking.drop_location}.`,
      type: 'booking',
      meta: { booking_id: booking.id, trip_join_request_id: request.id },
    });

    const fresh = await TripJoinRequestModel.findById(request.id);
    emitTripJoinRequestCreated(targetTrip.driver_id, fresh);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_JOIN_REQUEST_CREATED',
      entity: 'trip_join_requests',
      entityId: request.id,
      meta: { booking_id: booking.id, target_trip_id, truck_id: truckId },
      ipAddress: req.ip,
    });

    logger.info(`Trip join request ${request.id} created for booking ${booking.id} -> trip ${target_trip_id}`);
    return successResponse(res, 201, 'Request sent', { request: projectTripJoinRequest(fresh) });
  } catch (err) {
    next(err);
  }
};

// Shared accept finalization — re-validates the match is STILL good (another part-load request
// could have been accepted onto the same truck in the meantime), then builds a second,
// independent trips row for this booking, same shape as finalizeDriverRequest but WITHOUT
// touching truck/driver status (already 'on_trip') or creating a driver_requests-style CAS dance
// (v1: plain accept/decline only, confirmed — no negotiation on this table).
const finalizeTripJoinRequest = async (request) => {
  const booking = await BookingModel.findById(request.booking_id);
  if (!booking) return null;

  // Known v1 limitation: this re-check and the booking-status CAS below aren't wrapped in a
  // single DB transaction with row locking, so two DIFFERENT part-load requests being accepted
  // for the SAME truck's one remaining slot within the same instant could both pass this check
  // before either's booking flips to 'assigned' — a narrow window, same risk tolerance as the
  // rest of this codebase's CAS-based guards (e.g. BookingModel.advanceStatusIfCurrent itself
  // only guards one booking at a time, not a truck-wide invariant). Acceptable for v1; a real
  // fix would need an explicit row lock on the truck during this whole finalize step.
  const stillValidTruckId = await revalidateMatch(booking, request.target_trip_id);
  if (!stillValidTruckId) return null;

  const updatedBooking = await BookingModel.advanceStatusIfCurrent(booking.id, 'pending', {
    status: 'assigned',
    currentStep: STATUS_STEPS.indexOf('assigned'),
    brokerId: request.broker_id,
    driverId: request.driver_id,
    truckId: request.truck_id,
  });
  if (!updatedBooking) return null;

  await BookingModel.addTimelineStep(updatedBooking.id, { step: 'assigned', position: 1 });

  const stops = [
    { type: 'pickup', location: updatedBooking.pickup_location, lat: updatedBooking.pickup_lat, lng: updatedBooking.pickup_lng, status: 'pending', completedAt: null },
    ...(updatedBooking.loading_locations || []).map((s) => ({ type: 'loading', location: s.location, lat: s.lat, lng: s.lng, status: 'pending', completedAt: null })),
    ...(updatedBooking.unloading_locations || []).map((s) => ({ type: 'unloading', location: s.location, lat: s.lat, lng: s.lng, status: 'pending', completedAt: null })),
    { type: 'drop', location: updatedBooking.drop_location, lat: updatedBooking.drop_lat, lng: updatedBooking.drop_lng, status: 'pending', completedAt: null },
  ];

  const configRow = await PricingModel.getConfig();
  const baseSlaHours = PricingModel.getExpectedDeliveryHours(updatedBooking.distance, configRow?.config?.deliverySla);

  // A second, independent trips row — trips.booking_id stays strictly UNIQUE per booking, so
  // this does not conflict with the first trip (request.target_trip_id). Shares the same
  // driver_id/broker_id as that trip; the truck is reached the same indirect way every trip
  // reaches it (via this booking's own truck_id).
  const trip = await TripModel.create({
    bookingId: updatedBooking.id,
    driverId: request.driver_id,
    brokerId: request.broker_id,
    pickupAddress: updatedBooking.pickup_location,
    pickupLat: updatedBooking.pickup_lat,
    pickupLng: updatedBooking.pickup_lng,
    dropAddress: updatedBooking.drop_location,
    dropLat: updatedBooking.drop_lat,
    dropLng: updatedBooking.drop_lng,
    distance: updatedBooking.distance,
    cargoMaterial: updatedBooking.material,
    cargoWeight: updatedBooking.weight,
    cargoQuantity: updatedBooking.quantity,
    cargoValue: updatedBooking.amount,
    earnings: updatedBooking.amount && updatedBooking.platform_fee ? updatedBooking.amount - updatedBooking.platform_fee : updatedBooking.amount,
    stops,
    expectedDeliveryHours: baseSlaHours,
  });
  await TripModel.addTimelineStep(trip.id, { step: 'Pickup', done: false, position: 0, occurredAt: null });
  await TripModel.addTimelineStep(trip.id, { step: 'In Transit', done: false, position: 1, occurredAt: null });
  await TripModel.addTimelineStep(trip.id, { step: 'Delivered', done: false, position: 2, occurredAt: null });

  return { booking: updatedBooking, trip };
};

// ─── PATCH /api/trip-join-requests/:id/accept ─────────────────────────────────
const acceptTripJoinRequest = async (req, res, next) => {
  try {
    const request = await TripJoinRequestModel.findById(req.params.id);
    if (!request) return errorResponse(res, 404, 'Request not found');
    if (!assertCanRespond(request, req.user)) return errorResponse(res, 403, 'Not your request to respond to');

    const accepted = await TripJoinRequestModel.accept(request.id);
    if (!accepted) return errorResponse(res, 409, 'This request is no longer pending');

    const result = await finalizeTripJoinRequest(accepted);
    if (!result) {
      // The match went stale between accept and finalize (capacity taken by a race, or the
      // target trip ended) — roll the row back rather than leave it stuck 'accepted' with no
      // real trip behind it, same fix driver_requests' rollbackAccepted exists for.
      await TripJoinRequestModel.rollbackAccepted(request.id);
      const stale = await TripJoinRequestModel.findById(request.id);
      emitTripJoinRequestUpdate(request.broker_id, stale);
      return errorResponse(res, 409, 'This load is no longer available — the booking or truck may have moved on.');
    }

    await NotificationModel.create({
      userId: result.booking.client_id,
      title: 'Load Confirmed',
      message: `Your part-load request for ${result.booking.pickup_location} -> ${result.booking.drop_location} was accepted.`,
      type: 'booking',
      meta: { booking_id: result.booking.id, trip_id: result.trip.id },
    });

    const fresh = await TripJoinRequestModel.findById(request.id);
    emitTripJoinRequestUpdate(result.booking.client_id, fresh);
    emitTripJoinRequestUpdate(request.broker_id, fresh);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_JOIN_REQUEST_ACCEPTED',
      entity: 'trip_join_requests',
      entityId: request.id,
      meta: { booking_id: result.booking.id, trip_id: result.trip.id },
      ipAddress: req.ip,
    });

    logger.info(`Trip join request ${request.id} accepted — new trip ${result.trip.id} created for booking ${result.booking.id}`);
    return successResponse(res, 200, 'Request accepted', { request: projectTripJoinRequest(fresh) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/trip-join-requests/:id/decline ────────────────────────────────
const declineTripJoinRequest = async (req, res, next) => {
  try {
    const request = await TripJoinRequestModel.findById(req.params.id);
    if (!request) return errorResponse(res, 404, 'Request not found');
    if (!assertCanRespond(request, req.user)) return errorResponse(res, 403, 'Not your request to respond to');

    const declined = await TripJoinRequestModel.decline(request.id);
    if (!declined) return errorResponse(res, 409, 'This request is no longer pending');

    await NotificationModel.create({
      userId: request.client_id,
      title: 'Load Request Declined',
      message: `Your part-load request was declined — try a different truck.`,
      type: 'booking',
      meta: { booking_id: request.booking_id, trip_join_request_id: request.id },
    });

    const fresh = await TripJoinRequestModel.findById(request.id);
    emitTripJoinRequestUpdate(request.client_id, fresh);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'TRIP_JOIN_REQUEST_DECLINED',
      entity: 'trip_join_requests',
      entityId: request.id,
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Request declined', { request: projectTripJoinRequest(fresh) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trip-join-requests ──────────────────────────────────────────────
const listTripJoinRequests = async (req, res, next) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const result = req.user.role === 'broker'
      ? await TripJoinRequestModel.findTimedOutByBroker(req.user.id, { page: parseInt(page), limit: Math.min(parseInt(limit), 100) })
      : await TripJoinRequestModel.findByDriver(req.user.id, { page: parseInt(page), limit: Math.min(parseInt(limit), 100) });

    return successResponse(res, 200, 'Trip join requests fetched', { ...result, requests: result.requests.map(projectTripJoinRequest) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trip-join-requests/:id ──────────────────────────────────────────
const getTripJoinRequest = async (req, res, next) => {
  try {
    const request = await TripJoinRequestModel.findById(req.params.id);
    if (!request) return errorResponse(res, 404, 'Request not found');
    const isParty = [request.client_id, request.driver_id, request.broker_id].includes(req.user.id);
    if (!isParty && req.user.role !== 'admin') return errorResponse(res, 403, 'Not your request');
    return successResponse(res, 200, 'Request fetched', { request: projectTripJoinRequest(request) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/trip-join-requests/booking/:bookingId ───────────────────────────
// Lets the client poll their own part-load booking's request status without needing the
// request's own id (which they never directly chose — createTripJoinRequest returns it, but a
// page reload shouldn't require the client to have kept it).
const getTripJoinRequestForBooking = async (req, res, next) => {
  try {
    const request = await TripJoinRequestModel.findByBookingId(req.params.bookingId);
    if (!request) return errorResponse(res, 404, 'No request found for this booking');
    if (request.client_id !== req.user.id && req.user.role !== 'admin') return errorResponse(res, 403, 'Not your booking');
    return successResponse(res, 200, 'Request fetched', { request: projectTripJoinRequest(request) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createTripJoinRequest, acceptTripJoinRequest, declineTripJoinRequest,
  listTripJoinRequests, getTripJoinRequest, getTripJoinRequestForBooking,
  projectTripJoinRequest, emitTripJoinRequestCreated, emitTripJoinRequestUpdate,
};
