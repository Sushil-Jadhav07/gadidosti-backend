const JobRequestModel = require('../models/jobRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const DriverRequestModel = require('../models/driverRequest.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { projectDriverRequest, emitDriverRequestUpdate } = require('./driverRequest.controller');
const { getIO } = require('../realtime/socket');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

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

const projectJobRequest = (row) => ({
  id: row.id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  clientName: row.client_name,
  clientPhone: row.client_phone,
  brokerName: row.broker_name,
  brokerPhone: row.broker_phone,
  pickup: row.pickup,
  drop: row.drop_location,
  distance: row.distance,
  truckType: row.truck_type,
  weight: row.weight ? `${row.weight} ${row.weight_unit || ''}`.trim() : null,
  amount: row.amount,
  status: row.status,
  // Only meaningful while status='awaiting_confirmation' — 'client' means the client already
  // committed and it's the broker's turn to confirm or decline; 'broker' means the reverse.
  pendingConfirmationBy: row.pending_confirmation_by || null,
  // Negotiation back-and-forth: [{ by: 'client'|'broker', amount, note, at }], oldest first.
  offerHistory: row.offer_history || [],
  timestamp: timeAgo(row.created_at),
});

// Pushes the fresh request straight to a specific user's socket (see socket.js's auto-joined
// `user:${id}` room) — this subsystem had no real-time push at all before mutual-confirmation;
// without it the new "please confirm" step would feel broken, waiting out an 8-15s poll cycle
// to find out it's your turn (or that your booking just got confirmed).
const emitJobRequestUpdate = (userId, jobRequest) => {
  if (!userId || !jobRequest) return;
  getIO()?.to(`user:${userId}`).emit('job-request-updated', projectJobRequest(jobRequest));
};

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

// ─── GET /api/bookings/:id/offers ──────────────────────────────────────────────
// Client's own view of every broker offer for one of their bookings — the counterpart to
// listJobRequests (a broker's view of offers they've sent). Registered under booking.routes.js
// since the URL is booking-scoped, but lives here since it needs projectJobRequest/JobRequestModel.
// Referenced by the broker-broadcast client screens (ChooseBroker.jsx, BookingDetail.jsx's
// OffersPanel) to poll every job_requests row for this booking, including declined ones (shown
// disabled/greyed rather than hidden) so the client can see the full picture of who responded.
const getBookingOffers = async (req, res, next) => {
  try {
    const { id } = req.params;

    const booking = await BookingModel.findById(id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');

    const rows = await JobRequestModel.findByBookingId(id);
    return successResponse(res, 200, 'Offers fetched', { offers: rows.map(projectJobRequest), bookingStatus: booking.status });
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

    if (!isReassignment) {
      // First-time assignment: don't lock the driver/truck in immediately — give the driver
      // a negotiation window with the client first, reusing the same driver_requests
      // machinery (and 2min -> broker -> 5min timing) already built for the direct
      // client-pick flow. jobRequestId marks this as the broker-assign origin, so decline/
      // expiry notifications go to the broker (who picked this driver) instead of the client
      // (who never picked a truck in this flow). The truck/driver only lock to on_trip, and
      // the trip only gets created, once the client actually accepts (clientAcceptDriverRequest).
      const driverRequest = await DriverRequestModel.create({
        bookingId: booking.id,
        truckId,
        driverId,
        brokerId: req.user.id,
        amount: booking.amount,
        jobRequestId: jobRequest.id,
      });

      await NotificationModel.create({
        userId: driverId,
        title: 'New Ride Offer',
        message: `You've been offered a trip at ₹${booking.amount}: ${booking.pickup_location} -> ${booking.drop_location}. Accept, decline, or negotiate within 2 minutes.`,
        type: 'booking',
        meta: { booking_id: booking.id, driver_request_id: driverRequest.id },
      });

      // create()'s RETURNING * is the bare driver_requests row — missing the joined fields
      // (booking_number, client_name, driver_name, truck_reg, ...) projectDriverRequest reads,
      // so re-fetch through the joined query before using it in a response or a socket push.
      const fresh = await DriverRequestModel.findById(driverRequest.id);
      emitDriverRequestUpdate(driverId, fresh);
      // Also push to the client — they never call this endpoint themselves, but their app
      // (ChooseBroker.jsx) needs to find out a driver_requests row now exists for their
      // booking so it can hand off from "waiting for your broker to assign a driver" straight
      // into the driver negotiation, instead of only discovering it on the next poll tick.
      emitDriverRequestUpdate(booking.client_id, fresh);

      await AuditLogModel.log({
        userId: req.user.id,
        action: 'JOB_DRIVER_OFFERED',
        entity: 'job_requests',
        entityId: id,
        meta: { booking_id: booking.id, driver_request_id: driverRequest.id, driver_id: driverId, truck_id: truckId },
        ipAddress: req.ip,
      });

      return successResponse(res, 200, 'Driver offer sent — awaiting response', { request: projectDriverRequest(fresh) });
    }

    // Reassignment — stays instant, unlike the first-time path above: this is an urgent
    // operational fix (e.g. after an incident on an already-active trip), not a fresh
    // negotiation, so the driver doesn't get a window here.
    if (booking.driver_id && booking.driver_id !== driverId) {
      await DriverProfileModel.update(booking.driver_id, { status: 'available' });
    }
    if (booking.truck_id && booking.truck_id !== truckId) {
      await TruckModel.update(booking.truck_id, { status: 'available' });
    }

    await BookingModel.advanceStatus(booking.id, {
      // Keeps the booking's current status/step — a driver swap shouldn't regress an
      // in-transit shipment back to "assigned" in the client's tracker.
      status: booking.status,
      currentStep: booking.current_step,
      brokerId: req.user.id,
      driverId,
      truckId,
    });
    await BookingModel.addTimelineStep(booking.id, { step: 'driver_reassigned', position: 99 });

    await TruckModel.update(truckId, { status: 'on_trip' });
    await DriverProfileModel.update(driverId, { status: 'on_trip', truckId });

    const trip = await TripModel.reassignDriver(existingTrip.id, driverId);

    await NotificationModel.create({
      userId: driverId,
      title: 'Trip Reassigned to You',
      message: `You've been assigned to an in-progress trip: ${booking.pickup_location} -> ${booking.drop_location}`,
      type: 'booking',
      meta: { booking_id: booking.id, trip_id: trip.id },
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_DRIVER_REASSIGNED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: booking.id, trip_id: trip.id, driver_id: driverId, truck_id: truckId },
      ipAddress: req.ip,
    });

    const full = await BookingModel.findById(booking.id);
    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, 'Driver reassigned', { booking: {
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
    const canActNow = jobRequest.status === 'pending'
      || (jobRequest.status === 'awaiting_confirmation' && jobRequest.pending_confirmation_by === 'client');
    if (!canActNow) return errorResponse(res, 400, `Job request is already ${jobRequest.status}`);

    const updated = await JobRequestModel.setStatus(id, 'declined', ['pending', 'awaiting_confirmation']);
    if (!updated) return errorResponse(res, 400, 'Job request is already actioned');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_DECLINED',
      entity: 'job_requests',
      entityId: id,
      ipAddress: req.ip,
    });

    emitJobRequestUpdate(jobRequest.client_id, updated);

    return successResponse(res, 200, 'Job request declined', { request: updated });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/counter — broker submits a counter-offer ────────────────────
const counterJobRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, note } = req.body;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    if (jobRequest.status !== 'pending') return errorResponse(res, 400, `Job request is not awaiting your response (${jobRequest.status})`);

    const updated = await JobRequestModel.brokerCounter(id, { amount, note });
    if (!updated) return errorResponse(res, 400, 'Job request is already actioned');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_COUNTERED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: jobRequest.booking_id, amount },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: jobRequest.client_id,
      title: 'New Counter-Offer',
      message: `A broker countered with ₹${amount} for your booking (${jobRequest.pickup} to ${jobRequest.drop}).`,
      type: 'booking',
      meta: { booking_id: jobRequest.booking_id, job_request_id: id },
    });

    const full = await JobRequestModel.findById(id);
    emitJobRequestUpdate(jobRequest.client_id, full);
    return successResponse(res, 200, 'Counter-offer sent', { request: projectJobRequest(full) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/accept — broker agrees at the current amount ─────────────────
// Mutual-confirmation: dual-purpose CAS (JobRequestModel.brokerAccept). If the client hasn't
// already committed, this only commits the broker's own side (status -> 'awaiting_confirmation')
// and does NOT confirm the booking yet — the client must separately confirm via client-accept.
// If the client had already committed first, this call IS that second, finalizing confirmation.
const acceptJobRequest = async (req, res, next) => {
  try {
    const { id } = req.params;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your job request');
    const canActNow = jobRequest.status === 'pending'
      || (jobRequest.status === 'awaiting_confirmation' && jobRequest.pending_confirmation_by === 'client');
    if (!canActNow) return errorResponse(res, 400, `Job request is not awaiting your response (${jobRequest.status})`);

    const updated = await JobRequestModel.brokerAccept(id, req.user.id);
    if (!updated) return errorResponse(res, 400, 'Job request is already actioned');

    if (updated.status === 'awaiting_confirmation') {
      // First mover — the booking is NOT confirmed yet. Notify the client that it's their turn.
      await NotificationModel.create({
        userId: jobRequest.client_id,
        title: 'Broker Accepted — Please Confirm',
        message: `A broker accepted at ₹${updated.amount} for your booking (${jobRequest.pickup} to ${jobRequest.drop}). Confirm to finalize.`,
        type: 'booking',
        meta: { booking_id: jobRequest.booking_id, job_request_id: id },
      });
      const fresh = await JobRequestModel.findById(id);
      emitJobRequestUpdate(jobRequest.client_id, fresh);
      logger.info(`Job request ${id} accepted by broker ${req.user.id} — awaiting client confirmation`);
      return successResponse(res, 200, 'Accepted — waiting for the client to confirm', { request: projectJobRequest(fresh) });
    }

    const result = await finalizeJobRequest(updated, jobRequest);
    if (!result) {
      // Booking moved on some other way (e.g. the direct client-pick flow won it first) — must
      // CAS from 'accepted' (rollbackAccepted), not blindly overwrite — the row is already
      // 'accepted' here.
      await JobRequestModel.rollbackAccepted(id).catch(() => {});
      return errorResponse(res, 409, 'This booking is no longer available');
    }
    const { booking } = result;

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_ACCEPTED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: booking.id, amount: updated.amount },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: jobRequest.client_id,
      title: 'Booking Confirmed',
      message: `Your booking (${jobRequest.pickup} to ${jobRequest.drop}) is confirmed at ₹${updated.amount}.`,
      type: 'booking',
      meta: { booking_id: booking.id },
    });

    const fresh = await JobRequestModel.findById(id);
    emitJobRequestUpdate(jobRequest.client_id, fresh);

    logger.info(`Job request ${id} confirmed by broker ${req.user.id} — booking ${booking.id} confirmed`);
    return successResponse(res, 200, 'Booking confirmed', { booking: { id: booking.id, status: booking.status, brokerId: booking.broker_id, amount: booking.amount } });
  } catch (err) {
    next(err);
  }
};

// Shared by clientAcceptOffer and acceptJobRequest — runs once BOTH sides have mutually
// confirmed (the job_requests row is already 'accepted' by this point). Locks in the broker on
// the booking itself and cleans up sibling offers. Returns null if the booking moved on some
// other way in the meantime (e.g. the direct client-pick flow won it first) — caller must roll
// its own row back.
const finalizeJobRequest = async (acceptedJobRequest, originalJobRequest) => {
  const booking = await BookingModel.advanceStatusIfCurrent(acceptedJobRequest.booking_id, 'pending', {
    status: 'confirmed',
    currentStep: 1,
    brokerId: acceptedJobRequest.broker_id,
  });
  if (!booking) return null;

  if (acceptedJobRequest.amount != null && Number(booking.amount) !== Number(acceptedJobRequest.amount)) {
    await BookingModel.update(booking.id, { amount: acceptedJobRequest.amount });
  }

  await BookingModel.addTimelineStep(booking.id, { step: 'confirmed', position: 1 });
  await JobRequestModel.declineOthersForBooking(booking.id, acceptedJobRequest.id);

  return { booking };
};

// ─── PATCH /api/jobs/requests/:id/client-accept — client locks in a broker ─────────────────────
// Mutual-confirmation, same dual-purpose CAS pattern as acceptJobRequest above
// (JobRequestModel.clientAcceptIfCountered): if the broker hasn't already committed, this only
// commits the client's own side (status -> 'awaiting_confirmation') and does NOT confirm the
// booking yet. Only once BOTH sides have accepted does this actually lock in the broker.
const clientAcceptOffer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    const canActNow = ['pending', 'countered'].includes(jobRequest.status)
      || (jobRequest.status === 'awaiting_confirmation' && jobRequest.pending_confirmation_by === 'broker');
    if (!canActNow) return errorResponse(res, 400, `Offer is not awaiting your response (${jobRequest.status})`);

    // Same compare-and-swap shape as the broker's acceptJobRequest above — claim the offer
    // first, then the booking, so a second concurrent action on this booking can't both win.
    const claimed = await JobRequestModel.clientAcceptIfCountered(id);
    if (!claimed) return errorResponse(res, 400, 'Offer is already actioned');

    if (claimed.status === 'awaiting_confirmation') {
      // First mover — the booking is NOT confirmed yet. Notify the broker that it's their turn.
      await NotificationModel.create({
        userId: jobRequest.broker_id,
        title: 'Client Accepted — Please Confirm',
        message: `The client accepted your offer of ₹${claimed.amount}. Confirm to finalize the booking.`,
        type: 'booking',
        meta: { booking_id: jobRequest.booking_id, job_request_id: id },
      });
      const fresh = await JobRequestModel.findById(id);
      emitJobRequestUpdate(jobRequest.broker_id, fresh);
      logger.info(`Job request ${id} accepted by client ${req.user.id} — awaiting broker confirmation`);
      return successResponse(res, 200, 'Accepted — waiting for the broker to confirm', { request: projectJobRequest(fresh) });
    }

    const result = await finalizeJobRequest(claimed, jobRequest);
    if (!result) {
      await JobRequestModel.rollbackAccepted(id).catch(() => {});
      return errorResponse(res, 409, 'This booking is no longer available');
    }
    const { booking } = result;

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_CLIENT_ACCEPTED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: booking.id, amount: claimed.amount },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: jobRequest.broker_id,
      title: 'Offer Accepted',
      message: `Your offer of ₹${claimed.amount} was accepted. The booking is now confirmed.`,
      type: 'booking',
      meta: { booking_id: booking.id },
    });

    const fresh = await JobRequestModel.findById(id);
    emitJobRequestUpdate(jobRequest.broker_id, fresh);

    logger.info(`Job request ${id} accepted by client ${req.user.id}`);
    return successResponse(res, 200, 'Offer accepted', { booking: { id: booking.id, status: booking.status, brokerId: booking.broker_id, amount: booking.amount } });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/client-reject — client rejects a broker's counter-offer ─────
const clientRejectOffer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    const canActNow = jobRequest.status === 'countered'
      || (jobRequest.status === 'awaiting_confirmation' && jobRequest.pending_confirmation_by === 'broker');
    if (!canActNow) return errorResponse(res, 400, `Offer is not awaiting your response (${jobRequest.status})`);

    const updated = await JobRequestModel.clientRejectIfCountered(id);
    if (!updated) return errorResponse(res, 400, 'Offer is already actioned');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_CLIENT_REJECTED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: jobRequest.booking_id },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: jobRequest.broker_id,
      title: 'Offer Declined',
      message: `Your offer for booking ${jobRequest.pickup} to ${jobRequest.drop} was declined by the client.`,
      type: 'booking',
      meta: { booking_id: jobRequest.booking_id },
    });

    emitJobRequestUpdate(jobRequest.broker_id, updated);

    return successResponse(res, 200, 'Offer declined', { request: updated });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/client-counter — client proposes a new amount to one broker ──
// Works from 'pending' (proactively renegotiating before the broker has responded at all —
// e.g. the client taps "Negotiate" on a still-open offer) or 'countered' (responding to that
// broker's own counter). Either way, leaves it 'pending' so the broker owes a response.
const clientCounterOffer = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { amount, note } = req.body;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!['pending', 'countered'].includes(jobRequest.status)) return errorResponse(res, 400, `Offer is not awaiting your response (${jobRequest.status})`);

    const updated = await JobRequestModel.clientCounter(id, { amount, note });
    if (!updated) return errorResponse(res, 400, 'Offer is already actioned');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'JOB_REQUEST_CLIENT_COUNTERED',
      entity: 'job_requests',
      entityId: id,
      meta: { booking_id: jobRequest.booking_id, amount },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: jobRequest.broker_id,
      title: 'Client Countered Your Offer',
      message: `The client countered with ₹${amount} for booking ${jobRequest.pickup} to ${jobRequest.drop}.`,
      type: 'booking',
      meta: { booking_id: jobRequest.booking_id, job_request_id: id },
    });

    const full = await JobRequestModel.findById(id);
    emitJobRequestUpdate(jobRequest.broker_id, full);
    return successResponse(res, 200, 'Counter-offer sent', { request: projectJobRequest(full) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listJobRequests, getBookingOffers, assignDriver, declineJobRequest, acceptJobRequest,
  counterJobRequest, clientAcceptOffer, clientRejectOffer, clientCounterOffer,
};
