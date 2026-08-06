const JobRequestModel = require('../models/jobRequest.model');
const BookingModel = require('../models/booking.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const DriverRequestModel = require('../models/driverRequest.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { projectDriverRequest } = require('./driverRequest.controller');
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
  // Negotiation back-and-forth: [{ by: 'client'|'broker', amount, note, at }], oldest first.
  offerHistory: row.offer_history || [],
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

      await AuditLogModel.log({
        userId: req.user.id,
        action: 'JOB_DRIVER_OFFERED',
        entity: 'job_requests',
        entityId: id,
        meta: { booking_id: booking.id, driver_request_id: driverRequest.id, driver_id: driverId, truck_id: truckId },
        ipAddress: req.ip,
      });

      return successResponse(res, 200, 'Driver offer sent — awaiting response', { request: projectDriverRequest(driverRequest) });
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
    return successResponse(res, 200, 'Counter-offer sent', { request: projectJobRequest(full) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/jobs/requests/:id/client-accept — client locks in a broker ─────────────────────
// Works whether the broker has countered yet or not: 'pending' means the client is accepting
// the broker's still-open offer at the original asking price (no negotiation needed); 'countered'
// means the client is accepting whatever the broker last countered with. Same action either way.
const clientAcceptOffer = async (req, res, next) => {
  try {
    const { id } = req.params;

    const jobRequest = await JobRequestModel.findById(id);
    if (!jobRequest) return errorResponse(res, 404, 'Job request not found');
    if (jobRequest.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!['pending', 'countered'].includes(jobRequest.status)) return errorResponse(res, 400, `Offer is not awaiting your response (${jobRequest.status})`);

    // Same compare-and-swap shape as the broker's acceptJobRequest above — claim the offer
    // first, then the booking, so a second concurrent action on this booking can't both win.
    const claimed = await JobRequestModel.clientAcceptIfCountered(id);
    if (!claimed) return errorResponse(res, 400, 'Offer is already actioned');

    const booking = await BookingModel.advanceStatusIfCurrent(jobRequest.booking_id, 'pending', {
      status: 'confirmed',
      currentStep: 1,
      brokerId: jobRequest.broker_id,
    });

    if (!booking) {
      await JobRequestModel.setStatus(id, 'declined');
      return errorResponse(res, 409, 'This booking is no longer available');
    }

    if (claimed.amount != null && Number(booking.amount) !== Number(claimed.amount)) {
      await BookingModel.update(booking.id, { amount: claimed.amount });
    }

    await BookingModel.addTimelineStep(booking.id, { step: 'confirmed', position: 1 });
    await JobRequestModel.declineOthersForBooking(booking.id, id);

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
    if (jobRequest.status !== 'countered') return errorResponse(res, 400, `Offer is not awaiting your response (${jobRequest.status})`);

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
    return successResponse(res, 200, 'Counter-offer sent', { request: projectJobRequest(full) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listJobRequests, assignDriver, declineJobRequest,
  counterJobRequest, clientAcceptOffer, clientRejectOffer, clientCounterOffer,
};
