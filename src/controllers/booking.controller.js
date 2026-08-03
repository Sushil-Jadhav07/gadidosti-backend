const BookingModel = require('../models/booking.model');
const PricingModel = require('../models/pricing.model');
const JobRequestModel = require('../models/jobRequest.model');
const BrokerProfileModel = require('../models/brokerProfile.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse } = require('../utils/response');
const logger = require('../utils/logger');

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  if (role === 'admin') {
    base.client = row.client_name;
    base.clientPhone = row.client_phone;
    base.clientEmail = row.client_email;
    base.driverPhone = row.driver_phone;
    base.brokerPhone = row.broker_phone;
  }

  return base;
};

// ─── POST /api/bookings ──────────────────────────────────────────────────────
const createBooking = async (req, res, next) => {
  try {
    const {
      pickup_location, pickup_lat, pickup_lng, drop_location, drop_lat, drop_lng,
      truck_type, truck_category, weight, weight_unit, quantity, material,
      transport_type = 'intra', city, scheduled_date, distance, duration_min, duration_in_traffic_min,
      amount: providedAmount, payment_status, notes,
    } = req.body;

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
      logger.warn(`No brokers zoned for pickup city "${city || pickup_location}" — falling back to broadcasting to all ${brokerIds.length} active brokers`);
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

module.exports = { createBooking };
