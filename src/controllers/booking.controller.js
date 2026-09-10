const BookingModel = require('../models/booking.model');
const AnalyticsModel = require('../models/analytics.model');
const PricingModel = require('../models/pricing.model');
const JobRequestModel = require('../models/jobRequest.model');
const DriverRequestModel = require('../models/driverRequest.model');
const TruckModel = require('../models/truck.model');
const TripModel = require('../models/trip.model');
const DriverProfileModel = require('../models/driverProfile.model');
const TripIncidentModel = require('../models/tripIncident.model');
const BrokerProfileModel = require('../models/brokerProfile.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { haversineKm, AVERAGE_SPEED_KMPH } = require('../utils/geo');
const { projectDriverRequest, emitDriverRequestUpdate, emitDriverRequestCreated } = require('./driverRequest.controller');
const { emitJobRequestUpdate, emitJobRequestCreated } = require('./job.controller');
const { getIO } = require('../realtime/socket');
const { getPaymentProvider } = require('../providers/payment');

// Above this amount, Pay Later is no longer offered — the client must pay at least a 20%
// advance to confirm the booking (Pay Now for the full amount is still always available too).
// Mirrored in gadidosti-client's RequestDriver.jsx to decide which buttons to show; kept in
// sync manually since there's no shared config endpoint for this yet.
const ADVANCE_PAYMENT_THRESHOLD = 5000;
const ADVANCE_PAYMENT_PCT = 0.2;

// "Find Truck" mode default radius when the client doesn't send search_radius_km — matches
// NearbyTrucksMap.jsx's own default search radius (see pricing.model.js's NEARBY_SURGE_RADIUS_KM
// note for the same convention elsewhere).
const DEFAULT_BROADCAST_RADIUS_KM = 15;

// Book Later: how far ahead of the client's requested scheduled_date the deferred broadcast
// actually fires (see scheduledBookingBroadcastSweep.js). Not specified by the feature request —
// a judgment call to give drivers/brokers a reasonable window to respond before the requested
// time arrives, flagged here rather than silently assumed.
const SCHEDULED_BROADCAST_LEAD_HOURS = 2;

const projectBooking = (row, timeline, role) => {
  const base = {
    id: row.id,
    bookingNumber: row.booking_number,
    clientId: row.client_id,
    brokerId: row.broker_id,
    driverId: row.driver_id,
    truckId: row.truck_id,
    status: row.status,
    pickup: row.pickup_location,
    pickupLat: row.pickup_lat,
    pickupLng: row.pickup_lng,
    drop: row.drop_location,
    dropLat: row.drop_lat,
    dropLng: row.drop_lng,
    city: row.city,
    loadingLocations: row.loading_locations || [],
    unloadingLocations: row.unloading_locations || [],
    truckType: row.truck_type,
    truckCategory: row.truck_category,
    weight: row.weight,
    weightUnit: row.weight_unit,
    quantity: row.quantity,
    material: row.material,
    notes: row.notes || null,
    transportType: row.transport_type,
    date: row.scheduled_date,
    amount: row.amount,
    paymentStatus: row.payment_status,
    paymentMode: row.payment_mode || null,
    amountPaid: row.amount_paid != null ? Number(row.amount_paid) : 0,
    paidAt: row.paid_at || null,
    driver: { name: row.driver_name || null, phone: row.driver_phone || null },
    truckReg: row.truck_reg || null,
    broker: row.broker_name || null,
    timeline: timeline.map((t) => t.step),
    currentStep: row.current_step,
    pricing: row.pricing_breakdown,
    distance: row.distance,
    platformFee: row.platform_fee,
    podUrl: row.pod_url || null,
    rating: row.rating || null,
    // Live truck position + the full pickup/loading/unloading/drop sequence, sourced from the
    // linked trip — lets the broker's Job Detail map show the truck moving during the trip and
    // the complete stop checklist (with done/pending status) once it's over. Null/empty until
    // a trip actually exists for this booking.
    currentLat: row.trip_current_lat != null ? Number(row.trip_current_lat) : null,
    currentLng: row.trip_current_lng != null ? Number(row.trip_current_lng) : null,
    stops: row.trip_stops || [],
    // Total delivery duration, same computation as trip.controller.js's projectTrip — null
    // until the linked trip has both a started_at and a delivered_at.
    timeTakenMinutes: row.trip_started_at && row.trip_delivered_at
      ? Math.round((new Date(row.trip_delivered_at) - new Date(row.trip_started_at)) / 60000)
      : null,
    haltingHours: row.trip_halting_hours != null ? Number(row.trip_halting_hours) : 0,
    haltingCharge: row.trip_halting_charge != null ? Number(row.trip_halting_charge) : 0,
    isScheduled: row.is_scheduled || false,
    broadcastAt: row.broadcast_at || null,
    broadcastTriggeredAt: row.broadcast_triggered_at || null,
    searchMode: row.search_mode || null,
    searchRadiusKm: row.search_radius_km != null ? Number(row.search_radius_km) : null,
    selectedBrokerId: row.selected_broker_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  // A broker already has a legitimate relationship with the client on their own booking (they
  // can already see the client's phone elsewhere, e.g. job_requests/driver_requests
  // projections) — client contact fields here are needed so the broker's invoice-email UI can
  // pre-fill a recipient, not just for admin.
  if (role === 'admin' || role === 'broker') {
    base.client = row.client_name;
    base.clientPhone = row.client_phone;
    base.clientEmail = row.client_email;
  }

  if (role === 'admin') {
    base.driverPhone = row.driver_phone;
    base.brokerPhone = row.broker_phone;
    // Only admin ever needs to know a booking was soft-deleted by its broker/driver — that's
    // exactly the "still visible to admin" case this field exists for.
    base.deletedAt = row.deleted_at || null;
    base.deletedBy = row.deleted_by || null;
  }

  // The pickup verification code — client-only, deliberately never sent to driver/broker/admin
  // projections. The whole point is that the driver has to ask the client for it out loud, not
  // read it off their own screen; it never expires on its own, only once pickup_otp_verified_at
  // is set (see trip.controller.js's updateTripStatus, which is what actually checks it against
  // what the driver types in).
  if (role === 'client') {
    base.pickupOtp = row.trip_pickup_otp_code || null;
    base.pickupOtpVerified = !!row.trip_pickup_otp_verified_at;
  }

  return base;
};

const assertCanView = (booking, user) => {
  if (user.role === 'admin') return true;
  if (user.role === 'client') return booking.client_id === user.id;
  if (user.role === 'broker') return booking.broker_id === user.id;
  if (user.role === 'driver') return booking.driver_id === user.id;
  return false;
};

// ─── GET /api/bookings ────────────────────────────────────────────────────────
// One role-aware endpoint instead of separate ones per role — BookingModel.findAll already
// branches internally on req.user.role: client -> own bookings, broker -> assigned to them,
// driver -> assigned to them, admin -> everything. Same for GET /api/bookings/:id below.
const listBookings = async (req, res, next) => {
  try {
    const { status, sort = 'desc', page = 1, limit = 10 } = req.query;

    const result = await BookingModel.findAll({
      role: req.user.role,
      userId: req.user.id,
      status,
      sort,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    const bookings = await Promise.all(
      result.bookings.map(async (row) => {
        const timeline = await BookingModel.getTimeline(row.id);
        return projectBooking(row, timeline, req.user.role);
      })
    );

    return successResponse(res, 200, 'Bookings fetched', { ...result, bookings });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bookings/:id ────────────────────────────────────────────────────
const getBooking = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');
    // A broker/driver-soft-deleted booking is invisible to that same broker/driver (but the
    // row still fully exists — assertCanView already let admin through unconditionally above).
    if (booking.deleted_at && ['broker', 'driver'].includes(req.user.role)) {
      return errorResponse(res, 404, 'Booking not found');
    }

    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, 'Booking fetched', { booking: projectBooking(booking, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bookings/:id/track ─────────────────────────────────────────────
// Polled by the frontend every 5-10s — plain lat/lng snapshot, no WebSocket infra.
const trackBooking = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (!assertCanView(booking, req.user)) return errorResponse(res, 403, 'You do not have access to this booking');

    // Surfaced so the client's tracking screen can show an incident banner without a
    // separate call to GET /api/trips/:id/incidents. Fetched first (not just for the
    // incident) since a delivered/completed booking needs it for the frozen-location branch
    // below too.
    const trip = await TripModel.findByBookingId(booking.id);
    const incident = trip ? await TripIncidentModel.findLatestUnresolvedByTrip(trip.id) : null;

    // Once a trip is delivered/completed, the driver's location keeps moving (their next
    // trip, heading home, etc.) — driver_profiles.current_lat/lng is the driver's live
    // position, not this trip's. Showing it here would silently drift the map away from
    // where this shipment actually ended up. trips.current_lat/lng, by contrast, stops
    // updating the moment this trip leaves the driver's "active trip" (GET /api/trips/active
    // excludes delivered/completed/cancelled — see useDriverLocationTracking.js), so it's
    // frozen at (or very near) the real delivery point — exactly what a finished shipment's
    // tracking screen should show.
    const isTerminal = ['delivered', 'completed'].includes(booking.status);
    const location = isTerminal
      ? (trip && trip.current_lat != null && trip.current_lng != null ? { current_lat: trip.current_lat, current_lng: trip.current_lng, last_location_at: trip.delivered_at } : null)
      : (booking.driver_id ? await DriverProfileModel.findLocation(booking.driver_id) : null);
    const hasLocation = !!(location && location.current_lat != null && location.current_lng != null);

    let distanceRemainingKm = null;
    let etaMinutes = null;
    if (!isTerminal && hasLocation && booking.drop_lat != null && booking.drop_lng != null) {
      distanceRemainingKm = haversineKm(
        Number(location.current_lat), Number(location.current_lng),
        Number(booking.drop_lat), Number(booking.drop_lng)
      );
      etaMinutes = Math.round((distanceRemainingKm / AVERAGE_SPEED_KMPH) * 60);
    }

    // Only sourced from driver_profiles.current_heading — trips has no heading column, so the
    // terminal (frozen-location) branch above never has one to show; direction of travel isn't
    // meaningful for an already-delivered shipment anyway.
    const hasHeading = !isTerminal && hasLocation && location.current_heading != null;

    return successResponse(res, 200, 'Booking location fetched', {
      status: booking.status,
      driverLat: hasLocation ? Number(location.current_lat) : null,
      driverLng: hasLocation ? Number(location.current_lng) : null,
      driverHeading: hasHeading ? Number(location.current_heading) : null,
      lastLocationAt: location ? location.last_location_at : null,
      isTerminal,
      deliveredAt: trip?.delivered_at || null,
      distanceRemainingKm: distanceRemainingKm != null ? Math.round(distanceRemainingKm * 100) / 100 : null,
      etaMinutes,
      // Client-only — never sent to driver/broker/admin (same gating as projectBooking's
      // pickupOtp). The driver has to ask the client for this out loud, not read it from their
      // own screen. See trip.controller.js's updateTripStatus for where it's actually checked.
      ...(req.user.role === 'client' ? {
        pickupOtp: trip?.pickup_otp_code || null,
        pickupOtpVerified: !!trip?.pickup_otp_verified_at,
      } : {}),
      incident: incident ? {
        reason: incident.reason,
        notes: incident.notes,
        status: incident.status,
        reportedAt: incident.reported_at,
        // Only set for reason='breakdown' — lets the client see "mechanic on the way" instead
        // of just a generic "we're on it" message.
        mechanicStatus: incident.mechanic_status || null,
      } : null,
    });
  } catch (err) {
    next(err);
  }
};

// A booking may be cancelled by the client any time before cargo is actually picked up —
// once picked_up/in_transit/delivered/completed, the goods are already in the truck, so a
// straight cancel is no longer appropriate (report-a-problem/dispute is the right path then).
const CANCELLABLE_STATUSES = ['pending', 'confirmed', 'assigned', 'en_route_pickup'];

// ─── PATCH /api/bookings/:id/cancel ───────────────────────────────────────────
// Client-initiated cancellation, with a required reason. Covers every stage from a still-open
// request (no broker/driver yet) through an already-assigned, en-route driver — previously
// only cancellable while still 'pending', which meant a client couldn't back out at all once
// a driver had taken the job.
const cancelBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    if (!reason || !reason.trim()) return errorResponse(res, 422, 'A cancellation reason is required');

    const booking = await BookingModel.findById(id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!CANCELLABLE_STATUSES.includes(booking.status)) {
      return errorResponse(res, 409, `This booking can no longer be cancelled (status: ${booking.status})`);
    }

    const wasPaid = booking.payment_status === 'paid';
    await BookingModel.update(id, {
      status: 'cancelled',
      payment_status: wasPaid ? 'refunded' : booking.payment_status,
    });
    await BookingModel.addTimelineStep(id, { step: 'cancelled', position: 99 });

    // Clear out any still-open negotiation offers so nobody can accept a booking that's just
    // been cancelled out from under them — and notify each one, since a silent bulk-decline
    // with no push/notification would otherwise leave that driver/broker's card sitting stale
    // (still 'pending'/'countered') until they happen to reload the page.
    const declinedJobRequests = await JobRequestModel.declineAllForBooking(id);
    await Promise.all(declinedJobRequests.map(async (row) => {
      if (row.broker_id) {
        await NotificationModel.create({
          userId: row.broker_id,
          title: 'Booking Cancelled',
          message: `The client cancelled booking ${booking.booking_number} before it was confirmed.`,
          type: 'booking',
          meta: { booking_id: id, job_request_id: row.id },
        });
      }
      const fresh = await JobRequestModel.findById(row.id);
      emitJobRequestUpdate(row.broker_id, fresh);
    }));

    const declinedDriverRequests = await DriverRequestModel.declineAllForBooking(id);
    await Promise.all(declinedDriverRequests.map(async (row) => {
      const notifyUserId = row.driver_timeout_at ? row.broker_id : row.driver_id;
      if (notifyUserId) {
        await NotificationModel.create({
          userId: notifyUserId,
          title: 'Booking Cancelled',
          message: `The client cancelled booking ${booking.booking_number} before it was confirmed.`,
          type: 'booking',
          meta: { booking_id: id, driver_request_id: row.id },
        });
      }
      const fresh = await DriverRequestModel.findById(row.id);
      emitDriverRequestUpdate(notifyUserId, fresh);
    }));

    // A driver/truck may already be assigned (confirmed/assigned/en_route_pickup) — free them
    // up and cancel the linked trip too, same release-on-cancel logic trip.controller.js's
    // updateTripStatus already uses for a driver-initiated cancellation.
    const trip = await TripModel.findByBookingId(id);
    if (trip) {
      await TripModel.updateStatus(trip.id, 'cancelled');
      await TripModel.addTimelineStep(trip.id, { step: 'cancelled', position: 99 });
      if (trip.driver_id) await DriverProfileModel.update(trip.driver_id, { status: 'available' });
      if (trip.truck_id) await TruckModel.update(trip.truck_id, { status: 'available' });
    } else if (booking.driver_id || booking.truck_id) {
      if (booking.driver_id) await DriverProfileModel.update(booking.driver_id, { status: 'available' });
      if (booking.truck_id) await TruckModel.update(booking.truck_id, { status: 'available' });
    }

    const driverId = trip?.driver_id || booking.driver_id;
    if (driverId) {
      await NotificationModel.create({
        userId: driverId,
        title: 'Booking Cancelled',
        message: `The client cancelled booking ${booking.booking_number}. Reason: ${reason.trim()}`,
        type: 'booking',
        meta: { booking_id: id, reason: reason.trim() },
      });
    }
    const brokerId = trip?.broker_id || booking.broker_id;
    if (brokerId) {
      await NotificationModel.create({
        userId: brokerId,
        title: 'Booking Cancelled',
        message: `The client cancelled booking ${booking.booking_number}. Reason: ${reason.trim()}`,
        type: 'booking',
        meta: { booking_id: id, reason: reason.trim() },
      });
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_CANCELLED_BY_CLIENT',
      entity: 'bookings',
      entityId: id,
      meta: { reason: reason.trim(), previous_status: booking.status },
      ipAddress: req.ip,
    });

    logger.info(`Booking ${id} cancelled by client ${req.user.id}: ${reason.trim()}`);
    const full = await BookingModel.findById(id);
    const timeline = await BookingModel.getTimeline(id);
    return successResponse(res, 200, 'Booking cancelled', { booking: projectBooking(full, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// Shared eligibility check for anything that's about to take the client's money — the direct
// /pay endpoint (fake/manual mode), and both ends of the real-gateway flow below (order
// creation AND verification both re-check this, since time passes between the two and another
// payment could've landed, or the booking could've been cancelled, in between).
const checkPayable = (booking, userId, pay_type) => {
  if (!booking) return { status: 404, message: 'Booking not found' };
  if (booking.client_id !== userId) return { status: 403, message: 'Not your booking' };
  if (['paid', 'partial'].includes(booking.payment_status)) {
    return { status: 409, message: 'A payment has already been recorded for this booking' };
  }
  if (booking.status === 'cancelled') return { status: 409, message: 'This booking is cancelled' };
  // The 20% advance only exists as an alternative to Pay Later above ADVANCE_PAYMENT_THRESHOLD
  // (see gadidosti-client's RequestDriver.jsx, which is the only caller that ever sends
  // pay_type: 'advance') — reject it here too rather than trusting the client not to send it
  // for a cheap booking, since that would let someone underpay a sub-threshold booking.
  if (pay_type === 'advance' && Number(booking.amount) <= ADVANCE_PAYMENT_THRESHOLD) {
    return { status: 422, message: `Advance payment only applies to bookings over ₹${ADVANCE_PAYMENT_THRESHOLD}` };
  }
  return null;
};

const computeAmountPaid = (booking, pay_type) => (
  pay_type === 'advance'
    ? Math.round(Number(booking.amount) * ADVANCE_PAYMENT_PCT * 100) / 100
    : Number(booking.amount)
);

// Actually records a completed payment — DB update, driver/broker notification + live push,
// audit log, and the re-projected booking to hand back. Used by both the direct /pay endpoint
// (fake/manual "mark paid") and /payment/verify (real gateway, only reached after the
// signature checks out) so the two can never diverge in what "paid" actually does.
const finalizePayment = async ({ id, booking, pay_type, payment_mode, user }) => {
  const amountPaid = computeAmountPaid(booking, pay_type);
  const paymentStatus = pay_type === 'advance' ? 'partial' : 'paid';

  await BookingModel.update(id, {
    payment_status: paymentStatus,
    payment_mode: payment_mode || null,
    amount_paid: amountPaid,
    paid_at: new Date(),
  });

  // Whoever's assigned to this booking (driver/broker) should see "paid" without having to
  // reach the delivery-completion screen first — a trip may already exist by this point
  // (booking status 'assigned' or later), so prefer its driver_id/broker_id, falling back to
  // the booking row's own for the rare case a trip hasn't been created yet.
  const trip = await TripModel.findByBookingId(id);
  const driverId = trip?.driver_id || booking.driver_id;
  const brokerId = trip?.broker_id || booking.broker_id;
  const modeLabel = payment_mode ? payment_mode.toUpperCase() : 'the app';
  const remaining = Math.round((Number(booking.amount) - amountPaid) * 100) / 100;
  const notificationMessage = pay_type === 'advance'
    ? `The client paid a 20% advance (₹${amountPaid}) for booking ${booking.booking_number} via ${modeLabel} — ₹${remaining} remains to collect on delivery.`
    : `The client paid for booking ${booking.booking_number} via ${modeLabel} — no COD collection needed.`;
  for (const [userId, title] of [[driverId, 'Payment Received'], [brokerId, 'Payment Received']]) {
    if (!userId) continue;
    await NotificationModel.create({
      userId,
      title,
      message: notificationMessage,
      type: 'payment',
      meta: { booking_id: id, payment_mode: payment_mode || null, pay_type, amount_paid: amountPaid },
    });
    getIO()?.to(`user:${userId}`).emit('booking-payment-updated', {
      bookingId: id,
      bookingNumber: booking.booking_number,
      paymentStatus,
      paymentMode: payment_mode || null,
      amountPaid,
    });
  }

  await AuditLogModel.log({
    userId: user.id,
    action: 'BOOKING_PAID_BY_CLIENT',
    entity: 'bookings',
    entityId: id,
    meta: { payment_mode: payment_mode || null, pay_type, amount_paid: amountPaid },
    ipAddress: user.ip,
  });

  logger.info(`Booking ${id} marked ${paymentStatus} by client ${user.id} (mode: ${payment_mode || 'unspecified'}, pay_type: ${pay_type})`);
  const full = await BookingModel.findById(id);
  const timeline = await BookingModel.getTimeline(id);
  return { booking: projectBooking(full, timeline, user.role) };
};

// ─── PATCH /api/bookings/:id/pay ──────────────────────────────────────────────
// Client marks a booking as paid directly — no gateway round-trip. Used only by
// PAYMENT_PROVIDER=fake's simulated checkout in the past; nothing in gadidosti-client calls
// this anymore (it now goes through createPaymentOrder/verifyBookingPayment below, for both the
// fake and real-gateway cases). Once PAYMENT_PROVIDER=razorpay is active, this endpoint is
// blocked outright — without that block, it's a free "mark myself as paid" bypass the moment
// real money is on the line, since nothing here ever asks a gateway whether a payment actually
// happened. That was harmless while every "payment" was simulated; it stops being harmless the
// instant a real gateway goes live. (Driver/broker in-person COD collection is a separate
// endpoint, trip.controller.js's collectPayment, and unaffected by this.)
const payBooking = async (req, res, next) => {
  try {
    if (process.env.PAYMENT_PROVIDER === 'razorpay') {
      return errorResponse(res, 409, 'Online payments must go through the payment gateway — use /payment/order and /payment/verify instead.');
    }

    const { id } = req.params;
    const { payment_mode, pay_type = 'full' } = req.body;
    if (!['full', 'advance'].includes(pay_type)) {
      return errorResponse(res, 422, "pay_type must be 'full' or 'advance'");
    }

    const booking = await BookingModel.findById(id);
    const ineligible = checkPayable(booking, req.user.id, pay_type);
    if (ineligible) return errorResponse(res, ineligible.status, ineligible.message);

    const result = await finalizePayment({ id, booking, pay_type, payment_mode, user: { ...req.user, ip: req.ip } });
    return successResponse(res, 200, 'Payment recorded', result);
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/:id/payment/order ──────────────────────────────────────
// Client wants to pay online — opens a gateway order (a real Razorpay order when
// PAYMENT_PROVIDER=razorpay, a mock one in fake/demo mode) for the client's checkout widget to
// run against. Doesn't touch payment_status at all yet — only verifyBookingPayment does that,
// once the signature actually checks out.
const createPaymentOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pay_type = 'full' } = req.body;
    if (!['full', 'advance'].includes(pay_type)) {
      return errorResponse(res, 422, "pay_type must be 'full' or 'advance'");
    }

    const booking = await BookingModel.findById(id);
    const ineligible = checkPayable(booking, req.user.id, pay_type);
    if (ineligible) return errorResponse(res, ineligible.status, ineligible.message);

    const amount = computeAmountPaid(booking, pay_type);
    const order = await getPaymentProvider().createOrder({ bookingId: id, amount });
    return successResponse(res, 200, 'Order created', { order, pay_type });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/:id/payment/verify ─────────────────────────────────────
// Client's checkout widget completed — verify the gateway's signature server-side (never trust
// a bare "it succeeded" from the frontend) before recording anything as paid.
const verifyBookingPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { order_id, pay_type = 'full', payment_mode = 'razorpay', ...payload } = req.body;
    if (!order_id) return errorResponse(res, 422, 'order_id is required');
    if (!['full', 'advance'].includes(pay_type)) {
      return errorResponse(res, 422, "pay_type must be 'full' or 'advance'");
    }

    const booking = await BookingModel.findById(id);
    const ineligible = checkPayable(booking, req.user.id, pay_type);
    if (ineligible) return errorResponse(res, ineligible.status, ineligible.message);

    const verification = await getPaymentProvider().verifyPayment({ orderId: order_id, payload });
    if (!verification.success) return errorResponse(res, 402, 'Payment verification failed');

    const result = await finalizePayment({ id, booking, pay_type, payment_mode, user: { ...req.user, ip: req.ip } });
    return successResponse(res, 200, 'Payment verified', result);
  } catch (err) {
    next(err);
  }
};

// Only after actual delivery, and only once — mirrors gadidosti-client's own
// isRatable = ["Delivered", "Completed"].includes(booking.status) && !booking.rating gate
// (BookingDetail.jsx), enforced here too since the client-side check alone can't be trusted.
const RATABLE_STATUSES = ['delivered', 'completed'];

// ─── POST /api/bookings/:id/rate ────────────────────────────────────────────────
const rateBooking = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { stars, review } = req.body;
    const numericStars = Number(stars);
    if (!Number.isInteger(numericStars) || numericStars < 1 || numericStars > 5) {
      return errorResponse(res, 422, 'stars must be an integer from 1 to 5');
    }

    const booking = await BookingModel.findById(id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!RATABLE_STATUSES.includes(booking.status)) {
      return errorResponse(res, 409, 'This booking can only be rated once it has been delivered');
    }
    if (booking.rating) return errorResponse(res, 409, 'This booking has already been rated');

    const rating = { stars: numericStars, review: review?.trim() || null, ratedAt: new Date().toISOString() };
    await BookingModel.update(id, { rating: JSON.stringify(rating) });

    // Let whoever delivered it know how they did.
    const trip = await TripModel.findByBookingId(id);
    const driverId = trip?.driver_id || booking.driver_id;
    const brokerId = trip?.broker_id || booking.broker_id;
    for (const userId of [driverId, brokerId]) {
      if (!userId) continue;
      await NotificationModel.create({
        userId,
        title: 'New Rating',
        message: `The client rated booking ${booking.booking_number || id} ${numericStars} star${numericStars === 1 ? '' : 's'}${rating.review ? `: "${rating.review}"` : '.'}`,
        type: 'general',
        meta: { booking_id: id, stars: numericStars },
      });
    }

    await AuditLogModel.log({
      userId: req.user.id, action: 'BOOKING_RATED', entity: 'bookings', entityId: id,
      meta: { stars: numericStars }, ipAddress: req.ip,
    });

    logger.info(`Booking ${id} rated ${numericStars} stars by client ${req.user.id}`);
    return successResponse(res, 200, 'Rating submitted', { rating });
  } catch (err) {
    next(err);
  }
};

// Only these statuses may be removed from a broker/driver's own list — an in-progress
// shipment (confirmed/assigned/en_route_pickup/picked_up/in_transit/delivered) can't be
// hidden this way, so an active or just-finished-but-unsettled trip is never accidentally
// lost from view.
const DELETABLE_STATUSES = ['pending', 'cancelled', 'completed'];

// ─── DELETE /api/bookings/:id ──────────────────────────────────────────────────
// Two different operations behind one endpoint, split entirely by role:
//   - admin: a real, irreversible DELETE FROM (BookingModel.hardDelete) — no status
//     restriction, admin has the final say.
//   - broker (or a self-registered driver, who is their own broker_id — the same
//     booking.broker_id match covers both without checking req.user.role at all) — a soft
//     hide (deleted_at set), only allowed while status is pending/cancelled/completed, and
//     the row stays fully visible to admin the whole time.
// A regular driver working under a real broker never matches booking.broker_id, so they're
// turned away with 403 regardless of status — matches "only admin and broker (or a
// broker-less driver) can delete."
const deleteBooking = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');

    if (req.user.role === 'admin') {
      await BookingModel.hardDelete(booking.id);
      await AuditLogModel.log({
        userId: req.user.id,
        action: 'BOOKING_HARD_DELETED',
        entity: 'bookings',
        entityId: booking.id,
        meta: { booking_number: booking.booking_number, status: booking.status },
        ipAddress: req.ip,
      });
      logger.info(`Booking ${booking.id} permanently deleted by admin ${req.user.id}`);
      return successResponse(res, 200, 'Booking permanently deleted');
    }

    if (booking.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (booking.deleted_at) return errorResponse(res, 409, 'Booking already deleted');
    if (!DELETABLE_STATUSES.includes(booking.status)) {
      return errorResponse(res, 409, `Cannot delete a booking with status "${booking.status}" — only pending, cancelled, or completed bookings can be removed from your list`);
    }

    await BookingModel.softDelete(booking.id, req.user.id);
    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_SOFT_DELETED',
      entity: 'bookings',
      entityId: booking.id,
      meta: { booking_number: booking.booking_number, status: booking.status },
      ipAddress: req.ip,
    });
    logger.info(`Booking ${booking.id} soft-deleted by ${req.user.role} ${req.user.id}`);
    return successResponse(res, 200, 'Booking removed from your list — still visible to admin');
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/validate-location ────────────────────────────────────
// Lets the frontend gate progress past the Locations step before the user fills in Load
// Info / Truck / Review — runs the exact same pickup/drop/city rule as POST /api/bookings
// (createBookingValidation, shared verbatim) but writes nothing. If this 200s, the same
// payload's location fields are guaranteed to pass validation on the real POST /api/bookings
// call later, since both routes run the identical validation chain.
const validateLocation = async (req, res) => {
  return successResponse(res, 200, 'Location is valid', { valid: true });
};

// ─── POST /api/bookings/quote ─────────────────────────────────────────────────
// Preview a price before creating a booking — the same PricingModel.estimate() call
// createBooking makes internally when distance is given, exposed standalone so the frontend
// can show a live price on the Truck-selection step without actually creating anything.
const quoteBooking = async (req, res, next) => {
  try {
    const {
      truck_category, transport_type = 'intra', distance,
      capacity_used_pct, duration_min, duration_in_traffic_min,
      pickup_lat, pickup_lng,
    } = req.body;

    const breakdown = await PricingModel.estimate({
      truckCategory: truck_category,
      transportType: transport_type,
      distance,
      capacityUsedPct: capacity_used_pct,
      durationMin: duration_min,
      durationInTrafficMin: duration_in_traffic_min,
      pickupLat: pickup_lat,
      pickupLng: pickup_lng,
    });

    return successResponse(res, 200, 'Pricing estimate calculated', breakdown);
  } catch (err) {
    if (err.message === 'Pricing configuration not found') return errorResponse(res, 404, err.message);
    next(err);
  }
};

// Fans out a just-created (or just-due, for a scheduled booking) booking to the right
// audience, branching on its search_mode — called once, either synchronously from createBooking
// (immediate bookings) or from scheduledBookingBroadcastSweep.js (Book Later, once broadcast_at
// arrives). Takes the full booking row (as returned by BookingModel.create/findById), not the
// raw request body, so it works identically from either caller.
const broadcastBooking = async (booking) => {
  const pickupText = booking.pickup_location || 'an unspecified pickup point';
  const dropText = booking.drop_location || 'an unspecified drop point';

  // "Find Truck": broadcast the offered amount to every available driver within radius —
  // first to accept wins. Reuses driver_requests' existing sibling-decline machinery
  // (DriverRequestModel.declineOthersForBooking is already N-way generic) with zero changes;
  // only the fan-out at creation time is new.
  if (booking.search_mode === 'truck') {
    const candidates = await TruckModel.findNearbyForBroadcast({
      lat: booking.pickup_lat,
      lng: booking.pickup_lng,
      radiusKm: booking.search_radius_km || DEFAULT_BROADCAST_RADIUS_KM,
      category: booking.truck_category,
    });
    await Promise.all(candidates.map(async (c) => {
      const driverRequest = await DriverRequestModel.create({
        bookingId: booking.id,
        truckId: c.truck_id,
        driverId: c.driver_id,
        brokerId: c.broker_id,
        amount: booking.amount,
      });
      await NotificationModel.create({
        userId: c.driver_id,
        title: 'New Booking Request',
        message: `A client wants a truck for ${pickupText} -> ${dropText} at ₹${booking.amount ?? 'TBD'}. First to accept gets the job.`,
        type: 'booking',
        meta: { booking_id: booking.id, driver_request_id: driverRequest.id },
      });
      // Socket push (not just the push-notification above, which depends on the driver having
      // granted notification permission) — see FcmBridge.jsx's popup, which listens for this
      // exact event instead of relying solely on a foreground push.
      const fresh = await DriverRequestModel.findById(driverRequest.id);
      emitDriverRequestCreated(c.driver_id, fresh);
    }));
    logger.info(`Booking ${booking.id} broadcast to ${candidates.length} nearby drivers (radius ${booking.search_radius_km || DEFAULT_BROADCAST_RADIUS_KM}km)`);
    return;
  }

  // "Search for Broker": the client already picked exactly one broker (see
  // GET /api/bookings/eligible-brokers) — send the request to them alone, not every eligible
  // broker.
  if (booking.search_mode === 'broker') {
    if (!booking.selected_broker_id) {
      logger.warn(`Booking ${booking.id} has search_mode='broker' but no selected_broker_id — nothing to broadcast`);
      return;
    }
    const jobRequest = await JobRequestModel.create({
      bookingId: booking.id,
      brokerId: booking.selected_broker_id,
      distance: booking.distance,
      amount: booking.amount,
    });
    await NotificationModel.create({
      userId: booking.selected_broker_id,
      title: 'New Job Request',
      message: `A new booking (${pickupText} to ${dropText}) is awaiting your response.`,
      type: 'booking',
      meta: { booking_id: booking.id, job_request_id: jobRequest.id },
    });
    emitJobRequestCreated(booking.selected_broker_id, await JobRequestModel.findById(jobRequest.id));
    return;
  }

  // Legacy fallback — no search_mode sent (pre-existing clients, e.g. the Flutter app until it
  // adopts this feature): unchanged behavior, broadcast to every eligible broker. Falls back to
  // every active broker if zero brokers are zoned for this city, so a booking never silently
  // gets zero offers just because no broker has set up a matching service_city yet.
  let brokerIds = await BrokerProfileModel.findEligibleBrokers({ city: booking.city || pickupText });
  if (!brokerIds.length) {
    brokerIds = await UserModel.findActiveBrokers();
    logger.warn(`No brokers zoned for pickup city "${booking.city || pickupText}" — falling back to broadcasting to all ${brokerIds.length} active brokers`);
  }
  await Promise.all(brokerIds.map(async (brokerId) => {
    const jobRequest = await JobRequestModel.create({
      bookingId: booking.id,
      brokerId,
      distance: booking.distance,
      amount: booking.amount,
    });
    await NotificationModel.create({
      userId: brokerId,
      title: 'New Job Request',
      message: `A new booking (${pickupText} to ${dropText}) is awaiting your response.`,
      type: 'booking',
      meta: { booking_id: booking.id, job_request_id: jobRequest.id },
    });
    emitJobRequestCreated(brokerId, await JobRequestModel.findById(jobRequest.id));
  }));
};

// ─── GET /api/bookings/{id}/driver-requests ────────────────────────────────────
// The client's view of every driver_requests sibling for one of their own bookings — needed
// once "Find Truck" mode can fan a single booking out to many drivers at once (one row per
// driver within radius). GET /api/driver-requests/booking/:bookingId (getDriverRequestForBooking
// in driverRequest.controller.js) predates this fan-out and only ever returns requests[0] — the
// most recently created row, not necessarily the one that ends up accepted — so it can't be used
// to watch a multi-driver broadcast; this is the list counterpart, mirroring job.controller.js's
// getBookingOffers for job_requests.
const listBookingDriverRequests = async (req, res, next) => {
  try {
    const { id } = req.params;

    const booking = await BookingModel.findById(id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');

    const rows = await DriverRequestModel.findByBookingId(id);
    return successResponse(res, 200, 'Driver requests fetched', {
      requests: rows.map(projectDriverRequest),
      bookingStatus: booking.status,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/bookings/eligible-brokers ───────────────────────────────────────
// Not booking-scoped — called before a booking exists, so the client can browse brokers and
// pick exactly one for search_mode='broker' before/while submitting POST /api/bookings.
const listEligibleBrokers = async (req, res, next) => {
  try {
    const { city } = req.query;
    const brokers = await BrokerProfileModel.listEligibleForClient({ city: city || undefined });
    return successResponse(res, 200, 'Eligible brokers fetched', {
      brokers: brokers.map((b) => ({
        id: b.id,
        name: b.name,
        phone: b.phone,
        serviceCity: b.service_city,
        isOnline: b.is_online,
        truckCount: parseInt(b.truck_count, 10) || 0,
      })),
    });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings ──────────────────────────────────────────────────────
const createBooking = async (req, res, next) => {
  try {
    const {
      pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng,
      truck_type, truck_category, weight, weight_unit, quantity, material,
      transport_type = 'intra', city, scheduled_date, distance, duration_min, duration_in_traffic_min,
      amount: providedAmount, payment_status, notes,
      add_loading_location, add_unloading_location,
      search_mode, search_radius_km, broker_id, is_scheduled,
    } = req.body;

    // Nothing here is required (see booking.validation.js) — pickup_location/drop_location
    // can be missing, so every place that builds human-readable text from them needs a
    // fallback rather than printing "undefined".
    const pickupText = pickup_location || 'an unspecified pickup point';
    const dropText = drop_location || 'an unspecified drop point';

    if (search_mode === 'broker' && !broker_id) {
      return errorResponse(res, 422, 'broker_id is required when search_mode is "broker"');
    }

    let amount = providedAmount;
    let pricingBreakdown = null;
    let platformFee = null;

    if (distance != null) {
      pricingBreakdown = await PricingModel.estimate({
        truckCategory: truck_category,
        transportType: transport_type,
        distance,
        durationMin: duration_min,
        durationInTrafficMin: duration_in_traffic_min,
        pickupLat: pickup_lat,
        pickupLng: pickup_lng,
      });
      amount = amount != null ? amount : pricingBreakdown.total;
      platformFee = pricingBreakdown.platformFee;
    }

    // Book Later: when the client explicitly schedules for a future date/time, the booking row
    // is created right away (so it exists to browse/cancel) but the broker/driver broadcast is
    // deliberately deferred until close to that time (see SCHEDULED_BROADCAST_LEAD_HOURS above
    // and scheduledBookingBroadcastSweep.js) instead of firing immediately like a normal booking.
    const isScheduled = !!is_scheduled && !!scheduled_date;
    const broadcastAt = isScheduled
      ? new Date(new Date(scheduled_date).getTime() - SCHEDULED_BROADCAST_LEAD_HOURS * 3600 * 1000)
      : null;

    // No broker/truck is assigned at booking time — a broker picks up the request via the job
    // queue and assigns a driver + truck themselves (see POST /api/jobs/{id}/assign-driver).
    // city is only ever set for an intra-city booking (see booking.validation.js) — an
    // inter-city booking crosses city lines by definition, so it's stored as null.
    const booking = await BookingModel.create({
      clientId: req.user.id,
      pickupLocation: pickup_location,
      pickupLat: pickup_lat,
      pickupLng: pickup_lng,
      dropLocation: drop_location,
      dropLat: drop_lat,
      dropLng: drop_lng,
      city: transport_type === 'intra' ? city : null,
      truckType: truck_type,
      truckCategory: truck_category,
      weight,
      weightUnit: weight_unit,
      quantity,
      material,
      transportType: transport_type,
      scheduledDate: scheduled_date,
      amount,
      pricingBreakdown,
      distance,
      platformFee,
      paymentStatus: payment_status,
      notes,
      loadingLocations: add_loading_location,
      unloadingLocations: add_unloading_location,
      isScheduled,
      broadcastAt,
      searchMode: search_mode,
      searchRadiusKm: search_radius_km,
      selectedBrokerId: search_mode === 'broker' ? broker_id : null,
    });

    await BookingModel.addTimelineStep(booking.id, { step: 'pending', position: 0 });

    if (isScheduled) {
      logger.info(`Booking ${booking.id} scheduled — broadcast deferred to ${broadcastAt.toISOString()}`);
    } else {
      await broadcastBooking(booking);
      await BookingModel.markBroadcastTriggered(booking.id);
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_CREATED',
      entity: 'bookings',
      entityId: booking.id,
      meta: { transport_type, truck_category, city, search_mode: search_mode || null, is_scheduled: isScheduled },
      ipAddress: req.ip,
    });

    logger.info(`Booking created: ${booking.id} by client ${req.user.id}`);
    const full = await BookingModel.findById(booking.id);
    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 201, 'Booking created', { booking: projectBooking(full, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/bookings/:id/request-truck ─────────────────────────────────────
// The client's entry point into the direct negotiation flow — picks one specific truck
// (from GET /api/vehicles/trucks/nearby) and sends its driver a request at the booking's
// current amount, instead of waiting for the broker-broadcast (job_requests) flow to produce
// offers. Parallel to that flow, not a replacement — a booking can still separately receive
// broker job_request offers at the same time; whichever gets accepted first wins (the loser
// finds out via the 409 "This booking is no longer available" on its own accept attempt).
const requestTruckForBooking = async (req, res, next) => {
  try {
    const { truck_id } = req.body;

    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (booking.status !== 'pending') return errorResponse(res, 409, `Booking is no longer pending (${booking.status})`);

    const truck = await TruckModel.findById(truck_id);
    if (!truck) return errorResponse(res, 404, 'Truck not found');
    if (truck.status !== 'available') return errorResponse(res, 409, 'Truck is not available');
    if (!truck.driver_id) return errorResponse(res, 409, 'Truck has no driver assigned');

    const driverRequest = await DriverRequestModel.create({
      bookingId: booking.id,
      truckId: truck.id,
      driverId: truck.driver_id,
      brokerId: truck.broker_id,
      amount: booking.amount,
    });

    await NotificationModel.create({
      userId: truck.driver_id,
      title: 'New Booking Request',
      message: `A client wants to book your truck (${truck.registration}) for ${booking.pickup_location || 'pickup'} -> ${booking.drop_location || 'drop'} at ₹${booking.amount ?? 'TBD'}. Respond within a few minutes or your broker will be notified.`,
      type: 'booking',
      meta: { booking_id: booking.id, driver_request_id: driverRequest.id },
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DRIVER_REQUEST_CREATED',
      entity: 'driver_requests',
      entityId: driverRequest.id,
      meta: { booking_id: booking.id, truck_id: truck.id, driver_id: truck.driver_id },
      ipAddress: req.ip,
    });

    logger.info(`Driver request created: booking ${booking.id} -> truck ${truck.id} (driver ${truck.driver_id})`);
    const full = await DriverRequestModel.findById(driverRequest.id);
    emitDriverRequestCreated(truck.driver_id, full);
    return successResponse(res, 201, 'Request sent to driver', { request: projectDriverRequest(full) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/analytics/client ─────────────────────────────────────────────────
// Client-scoped mirror of GET /api/analytics/admin — the client dashboard's own "Recent
// Activities" stats plus the two chart series (spend sparkline, weekly booking count), all
// filtered to this client's own bookings.
const getClientAnalytics = async (req, res, next) => {
  try {
    const [stats, spendSparkline, weeklyBookings] = await Promise.all([
      AnalyticsModel.clientDashboard(req.user.id),
      AnalyticsModel.clientSpendSparkline(req.user.id),
      AnalyticsModel.clientWeeklyBookings(req.user.id),
    ]);

    return successResponse(res, 200, 'Client analytics fetched', { ...stats, spendSparkline, weeklyBookings });
  } catch (err) {
    next(err);
  }
};

module.exports = { createBooking, validateLocation, quoteBooking, listBookings, getBooking, trackBooking, requestTruckForBooking, cancelBooking, payBooking, createPaymentOrder, verifyBookingPayment, rateBooking, deleteBooking, getClientAnalytics, listEligibleBrokers, broadcastBooking, listBookingDriverRequests };
