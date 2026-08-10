const BookingModel = require('../models/booking.model');
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
const { projectDriverRequest } = require('./driverRequest.controller');

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

    const location = booking.driver_id ? await DriverProfileModel.findLocation(booking.driver_id) : null;
    const hasLocation = !!(location && location.current_lat != null && location.current_lng != null);

    let distanceRemainingKm = null;
    let etaMinutes = null;
    if (hasLocation && booking.drop_lat != null && booking.drop_lng != null) {
      distanceRemainingKm = haversineKm(
        Number(location.current_lat), Number(location.current_lng),
        Number(booking.drop_lat), Number(booking.drop_lng)
      );
      etaMinutes = Math.round((distanceRemainingKm / AVERAGE_SPEED_KMPH) * 60);
    }

    // Surfaced so the client's tracking screen can show an incident banner without a
    // separate call to GET /api/trips/:id/incidents.
    const trip = await TripModel.findByBookingId(booking.id);
    const incident = trip ? await TripIncidentModel.findLatestUnresolvedByTrip(trip.id) : null;

    return successResponse(res, 200, 'Booking location fetched', {
      status: booking.status,
      driverLat: hasLocation ? Number(location.current_lat) : null,
      driverLng: hasLocation ? Number(location.current_lng) : null,
      lastLocationAt: location ? location.last_location_at : null,
      distanceRemainingKm: distanceRemainingKm != null ? Math.round(distanceRemainingKm * 100) / 100 : null,
      etaMinutes,
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
    } = req.body;

    const breakdown = await PricingModel.estimate({
      truckCategory: truck_category,
      transportType: transport_type,
      distance,
      capacityUsedPct: capacity_used_pct,
      durationMin: duration_min,
      durationInTrafficMin: duration_in_traffic_min,
    });

    return successResponse(res, 200, 'Pricing estimate calculated', breakdown);
  } catch (err) {
    if (err.message === 'Pricing configuration not found') return errorResponse(res, 404, err.message);
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
    } = req.body;

    // Nothing here is required (see booking.validation.js) — pickup_location/drop_location
    // can be missing, so every place that builds human-readable text from them needs a
    // fallback rather than printing "undefined".
    const pickupText = pickup_location || 'an unspecified pickup point';
    const dropText = drop_location || 'an unspecified drop point';

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
      });
      amount = amount != null ? amount : pricingBreakdown.total;
      platformFee = pricingBreakdown.platformFee;
    }

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
    });

    await BookingModel.addTimelineStep(booking.id, { step: 'pending', position: 0 });

    // Broadcast to verified, active, online brokers whose service_city matches the pickup
    // location — each gets their own job_request row and can counter/decline, but only the
    // client can confirm one via client-accept (which auto-declines the sibling requests).
    // Falls back to every active broker if zero brokers are zoned for this city, so a booking
    // never silently gets zero offers just because no broker has set up a matching service_city yet.
    // Caveat: this is a straightforward string-equality match against pickup_location, which
    // is freeform text — pairs best with an exact city name. A real geocoding LocationProvider
    // (src/providers/location) would be a more robust way to derive the city from an address.
    let brokerIds = await BrokerProfileModel.findEligibleBrokers({ city: city || pickup_location });
    if (!brokerIds.length) {
      brokerIds = await UserModel.findActiveBrokers();
      logger.warn(`No brokers zoned for pickup city "${city || pickupText}" — falling back to broadcasting to all ${brokerIds.length} active brokers`);
    }
    await Promise.all(brokerIds.map(async (brokerId) => {
      const jobRequest = await JobRequestModel.create({
        bookingId: booking.id,
        brokerId,
        distance,
        amount,
      });
      await NotificationModel.create({
        userId: brokerId,
        title: 'New Job Request',
        message: `A new booking (${pickupText} to ${dropText}) is awaiting your response.`,
        type: 'booking',
        meta: { booking_id: booking.id, job_request_id: jobRequest.id },
      });
    }));

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_CREATED',
      entity: 'bookings',
      entityId: booking.id,
      meta: { transport_type, truck_category, city },
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
    return successResponse(res, 201, 'Request sent to driver', { request: projectDriverRequest(full) });
  } catch (err) {
    next(err);
  }
};

module.exports = { createBooking, validateLocation, quoteBooking, listBookings, getBooking, trackBooking, requestTruckForBooking, deleteBooking };
