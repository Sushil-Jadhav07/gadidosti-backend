const BookingModel = require('../models/booking.model');
const JobRequestModel = require('../models/jobRequest.model');
const PricingModel = require('../models/pricing.model');
const TripModel = require('../models/trip.model');
const TruckModel = require('../models/truck.model');
const DriverProfileModel = require('../models/driverProfile.model');
const BrokerProfileModel = require('../models/brokerProfile.model');
const TripIncidentModel = require('../models/tripIncident.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const pool = require('../config/db');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getPaymentProvider } = require('../providers/payment');

const paymentProvider = getPaymentProvider();

// Canonical progress-tracker order — position in this array drives current_step.
const STATUS_STEPS = ['pending', 'confirmed', 'assigned', 'en_route_pickup', 'picked_up', 'in_transit', 'delivered', 'completed'];

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
    truckType: row.truck_type,
    truckCategory: row.truck_category,
    weight: row.weight,
    weightUnit: row.weight_unit,
    quantity: row.quantity,
    material: row.material,
    transportType: row.transport_type,
    date: row.scheduled_date,
    amount: row.amount,
    paymentStatus: row.payment_status,
    driver: { name: row.driver_name || null, phone: row.driver_phone || null },
    truckReg: row.truck_reg || null,
    broker: row.broker_name || null,
    timeline: timeline.map((t) => t.step),
    currentStep: row.current_step,
    pricing: row.pricing_breakdown,
    distance: row.distance,
    platformFee: row.platform_fee,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (role === 'admin') {
    base.client = row.client_name;
    base.clientPhone = row.client_phone;
    base.clientEmail = row.client_email;
    base.driverPhone = row.driver_phone;
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

// ─── POST /api/bookings ──────────────────────────────────────────────────────
const createBooking = async (req, res, next) => {
  try {
    const {
      pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng,
      truck_type, truck_category, weight, weight_unit, quantity, material,
      transport_type = 'intra', scheduled_date, distance,
      amount: providedAmount, payment_status,
    } = req.body;

    let amount = providedAmount;
    let pricingBreakdown = null;
    let platformFee = null;

    if (distance != null) {
      pricingBreakdown = await PricingModel.estimate({ truckCategory: truck_category, transportType: transport_type, distance });
      amount = amount != null ? amount : pricingBreakdown.total;
      platformFee = pricingBreakdown.platformFee;
    }

    // No broker/truck is assigned at booking time — a broker picks up the request via the job
    // queue and assigns a driver + truck themselves (see POST /api/jobs/{id}/assign-driver).
    const booking = await BookingModel.create({
      clientId: req.user.id,
      pickupLocation: pickup_location,
      pickupLat: pickup_lat,
      pickupLng: pickup_lng,
      dropLocation: drop_location,
      dropLat: drop_lat,
      dropLng: drop_lng,
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
    });

    await BookingModel.addTimelineStep(booking.id, { step: 'pending', position: 0 });

    // Broadcast to verified, active, online brokers whose service_city matches the pickup
    // location — whichever one accepts first gets the job (acceptJobRequest() auto-declines
    // the sibling requests once someone takes it). Falls back to every active broker if zero
    // brokers are zoned for this city, so a booking never silently gets zero offers just
    // because no broker has set up a matching service_city yet.
    // Caveat: this is a straightforward string-equality match against pickup_location, which
    // is freeform text — pairs best with an exact city name. A real geocoding LocationProvider
    // (src/providers/location) would be a more robust way to derive the city from an address.
    let brokerIds = await BrokerProfileModel.findEligibleBrokers({ city: pickup_location });
    if (!brokerIds.length) {
      brokerIds = await UserModel.findActiveBrokers();
      logger.warn(`No brokers zoned for pickup city "${pickup_location}" — falling back to broadcasting to all ${brokerIds.length} active brokers`);
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
        message: `A new booking (${pickup_location} to ${drop_location}) is awaiting your response.`,
        type: 'booking',
        meta: { booking_id: booking.id, job_request_id: jobRequest.id },
      });
    }));

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_CREATED',
      entity: 'bookings',
      entityId: booking.id,
      meta: { transport_type, truck_category },
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

// ─── GET /api/bookings ───────────────────────────────────────────────────────
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

    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, 'Booking fetched', { booking: projectBooking(booking, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// Straight-line ETA only — no routing engine, so this is a rough estimate for the
// "how far out is my driver" UI, not turn-by-turn navigation.
const AVERAGE_SPEED_KMPH = 40;

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      } : null,
    });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/bookings/:id/status ──────────────────────────────────────────
const updateBookingStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, driver_id, truck_id } = req.body;

    const existing = await BookingModel.findById(id);
    if (!existing) return errorResponse(res, 404, 'Booking not found');
    if (!['admin', 'broker', 'driver'].includes(req.user.role)) return errorResponse(res, 403, 'Access denied');
    if (req.user.role === 'broker' && existing.broker_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (req.user.role === 'driver' && existing.driver_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');

    const stepIndex = STATUS_STEPS.indexOf(status);
    const currentStep = stepIndex >= 0 ? stepIndex : existing.current_step;

    const updated = await BookingModel.advanceStatus(id, {
      status,
      currentStep,
      brokerId: req.user.role === 'broker' ? req.user.id : undefined,
      driverId: driver_id,
      truckId: truck_id,
    });

    await BookingModel.addTimelineStep(id, { step: status, position: stepIndex >= 0 ? stepIndex : 99 });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_STATUS_UPDATED',
      entity: 'bookings',
      entityId: id,
      meta: { new_status: status },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: updated.client_id,
      title: 'Booking Update',
      message: `Your booking status changed to "${status.replace(/_/g, ' ')}".`,
      type: 'booking',
      meta: { booking_id: id, status },
    });

    logger.info(`Booking ${id} status -> ${status} by ${req.user.id}`);
    const full = await BookingModel.findById(id);
    const timeline = await BookingModel.getTimeline(id);
    return successResponse(res, 200, 'Booking status updated', { booking: projectBooking(full, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

const cancelBooking = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (req.user.role === 'client' && booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!['pending', 'confirmed', 'assigned'].includes(booking.status)) {
      return errorResponse(res, 409, 'Booking cannot be cancelled at this stage');
    }

    await BookingModel.update(booking.id, {
      status: 'cancelled',
      payment_status: 'refunded',
    });
    await BookingModel.addTimelineStep(booking.id, { step: 'cancelled', position: 99 });

    if (booking.truck_id) {
      await TruckModel.update(booking.truck_id, { status: 'available' });
    }

    if (booking.driver_id) {
      await DriverProfileModel.update(booking.driver_id, { status: 'available' });
    }

    if (booking.broker_id) {
      const requests = await JobRequestModel.findByBookingId(booking.id);
      await Promise.all(
        requests
          .filter((request) => ['pending', 'accepted'].includes(request.status))
          .map((request) => JobRequestModel.setStatus(request.id, 'declined'))
      );
    }

    await pool.query(
      `UPDATE trips SET status = 'cancelled', updated_at = NOW() WHERE booking_id = $1`,
      [booking.id]
    );

    if (booking.broker_id) {
      await NotificationModel.create({
        userId: booking.broker_id,
        title: 'Booking Cancelled',
        message: `Booking ${booking.pickup_location} -> ${booking.drop_location} was cancelled.`,
        type: 'booking',
        meta: { booking_id: booking.id },
      });
    }

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_CANCELLED',
      entity: 'bookings',
      entityId: booking.id,
      ipAddress: req.ip,
    });

    const full = await BookingModel.findById(booking.id);
    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, 'Booking cancelled', { booking: projectBooking(full, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/bookings/:id/pay ─────────────────────────────────────────────
// Settles a booking that was created with payment_status "pending" (Pay Later) —
// there's no real payment gateway wired up, this just records that the client paid.
const payBooking = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (booking.status === 'cancelled') return errorResponse(res, 409, 'Booking is cancelled');
    if (booking.payment_status !== 'pending') return errorResponse(res, 409, `Booking is already ${booking.payment_status}`);

    const order = await paymentProvider.createOrder({ bookingId: booking.id, amount: booking.amount });
    const verification = await paymentProvider.verifyPayment({ orderId: order.orderId, payload: req.body });
    if (!verification.success) return errorResponse(res, 402, 'Payment verification failed');

    await BookingModel.update(booking.id, { payment_status: 'paid' });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'BOOKING_PAID',
      entity: 'bookings',
      entityId: booking.id,
      ipAddress: req.ip,
    });

    const full = await BookingModel.findById(booking.id);
    const timeline = await BookingModel.getTimeline(booking.id);
    return successResponse(res, 200, 'Payment recorded', { booking: projectBooking(full, timeline, req.user.role) });
  } catch (err) {
    next(err);
  }
};

const rateBooking = async (req, res, next) => {
  try {
    const booking = await BookingModel.findById(req.params.id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');
    if (booking.client_id !== req.user.id) return errorResponse(res, 403, 'Not your booking');
    if (!['delivered', 'completed'].includes(booking.status)) {
      return errorResponse(res, 409, 'Booking cannot be rated yet');
    }
    if (booking.rating) return errorResponse(res, 409, 'Booking already rated');

    const rating = {
      stars: req.body.stars,
      review: req.body.review || '',
      createdAt: new Date().toISOString(),
    };

    await BookingModel.update(booking.id, { rating: JSON.stringify(rating) });

    return successResponse(res, 200, 'Booking rated', { rating });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/pricing/estimate, POST /api/bookings/quote ────────────────────
const estimatePricing = async (req, res, next) => {
  try {
    const { truck_category, transport_type = 'intra', distance, capacity_used_pct } = req.body;

    const breakdown = await PricingModel.estimate({
      truckCategory: truck_category,
      transportType: transport_type,
      distance,
      capacityUsedPct: capacity_used_pct,
    });

    // Admin gets the fuel/toll breakdown for inter-city; everyone else gets the
    // distanceFare/subtotal client view. Part-load quotes are shape-fixed regardless of role.
    if (transport_type === 'inter' && req.user?.role !== 'admin') {
      const { fuel, toll, ...clientView } = breakdown;
      return successResponse(res, 200, 'Pricing estimate calculated', { pricing: clientView });
    }

    return successResponse(res, 200, 'Pricing estimate calculated', { pricing: breakdown });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createBooking, listBookings, getBooking, trackBooking, updateBookingStatus, cancelBooking, payBooking, rateBooking, estimatePricing,
};
