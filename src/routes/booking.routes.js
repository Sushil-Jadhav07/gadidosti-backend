const express = require('express');
const router = express.Router();

const { createBooking, listBookings, getBooking, trackBooking, updateBookingStatus, cancelBooking, payBooking, rateBooking, estimatePricing } = require('../controllers/booking.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const idempotent = require('../middleware/idempotency.middleware');
const { createBookingValidation, updateBookingStatusValidation, rateBookingValidation } = require('../validations/booking.validation');
const { estimatePricingValidation } = require('../validations/pricing.validation');

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: Create a booking (client)
 *     description: No broker or truck is assigned at creation — the booking is broadcast as a job_request to every KYC-verified, active broker. Whichever broker accepts first (PATCH /api/jobs/requests/{id}/accept) wins it; everyone else's request is auto-declined. The winning broker then assigns a driver + truck themselves via POST /api/jobs/{id}/assign-driver.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup_location, drop_location]
 *             properties:
 *               pickup_location: { type: string }
 *               pickup_lat: { type: number }
 *               pickup_lng: { type: number }
 *               drop_location: { type: string }
 *               drop_lat: { type: number }
 *               drop_lng: { type: number }
 *               truck_type: { type: string }
 *               truck_category: { type: string, enum: [small, medium, large, part] }
 *               weight: { type: number }
 *               weight_unit: { type: string, default: tons }
 *               quantity: { type: integer }
 *               material: { type: string }
 *               transport_type: { type: string, enum: [intra, inter], default: intra }
 *               scheduled_date: { type: string, format: date-time }
 *               distance: { type: number, description: "If provided, pricing is auto-computed" }
 *               amount: { type: number, description: "Overrides the auto-computed total when provided" }
 *               payment_status: { type: string, enum: [paid, pending], default: pending, description: "'paid' for Pay Now, 'pending' for Pay Later — no real payment gateway is wired up, this just records the client's choice" }
 *     parameters:
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         description: Optional. A duplicate key + same user replays the original booking response instead of creating a new one.
 *         schema: { type: string }
 *     responses:
 *       201:
 *         description: Booking created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings', authenticate, authorize('client'), idempotent('POST /bookings'), createBookingValidation, validate, createBooking);

/**
 * @swagger
 * /api/bookings:
 *   get:
 *     tags: [Bookings]
 *     summary: List bookings (role-scoped)
 *     description: client -> own bookings, broker/driver -> assigned bookings, admin -> all bookings.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, confirmed, assigned, en_route_pickup, picked_up, in_transit, delivered, completed, cancelled, no_broker_available] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Bookings fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/bookings', authenticate, listBookings);

/**
 * @swagger
 * /api/bookings/quote:
 *   post:
 *     tags: [Bookings]
 *     summary: Quote a booking (alias of /api/pricing/estimate)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [truck_category, distance]
 *             properties:
 *               truck_category: { type: string, enum: [small, medium, large, part] }
 *               transport_type: { type: string, enum: [intra, inter], default: intra }
 *               distance: { type: number }
 *               capacity_used_pct: { type: number, description: "Only used for truck_category=part" }
 *     responses:
 *       200:
 *         description: Pricing estimate calculated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/bookings/quote', authenticate, estimatePricingValidation, validate, estimatePricing);

/**
 * @swagger
 * /api/bookings/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: Get a booking by ID or booking number (role-appropriate projection)
 *     description: Admin gets extra fields (client, clientPhone, clientEmail, driverPhone) that other roles don't. Accepts either the raw UUID or the human-readable booking_number (e.g. "BKG-202412-001").
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking UUID or booking_number
 *         schema: { type: string, example: 'BKG-202412-001' }
 *     responses:
 *       200:
 *         description: Booking fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: No access to this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/bookings/:id', authenticate, getBooking);

/**
 * @swagger
 * /api/bookings/{id}/track:
 *   get:
 *     tags: [Bookings]
 *     summary: Live-track a booking's assigned driver (client/broker/driver/admin)
 *     description: Meant to be polled every 5-10s, not pushed via WebSocket. Returns null location fields if no driver is assigned yet or no location has been reported yet. ETA is a straight-line estimate (no routing engine). Also surfaces the trip's latest unresolved incident, if any, so the client doesn't need a separate call to GET /api/trips/{id}/incidents.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking UUID or booking_number
 *         schema: { type: string, example: 'BKG-202412-001' }
 *     responses:
 *       200:
 *         description: Booking location fetched
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         status:               { type: string, enum: [pending, confirmed, assigned, en_route_pickup, picked_up, in_transit, delivered, completed, cancelled, no_broker_available] }
 *                         driverLat:            { type: number, nullable: true }
 *                         driverLng:            { type: number, nullable: true }
 *                         lastLocationAt:       { type: string, format: date-time, nullable: true }
 *                         distanceRemainingKm:  { type: number, nullable: true }
 *                         etaMinutes:           { type: integer, nullable: true }
 *                         incident:
 *                           type: object
 *                           nullable: true
 *                           description: The trip's latest unresolved incident, or null if there is none
 *                           properties:
 *                             reason:     { type: string, enum: [accident, breakdown, traffic_block, medical, other] }
 *                             notes:      { type: string, nullable: true }
 *                             status:     { type: string, enum: [reported, acknowledged, resolved] }
 *                             reportedAt: { type: string, format: date-time }
 *       403:
 *         description: No access to this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/bookings/:id/track', authenticate, trackBooking);

/**
 * @swagger
 * /api/bookings/{id}/status:
 *   patch:
 *     tags: [Bookings]
 *     summary: Advance a booking's status (broker/driver/admin)
 *     description: Appends a timeline entry, bumps current_step, and notifies the client.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [pending, confirmed, assigned, en_route_pickup, picked_up, in_transit, delivered, completed, cancelled] }
 *               driver_id: { type: string, format: uuid }
 *               truck_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Booking status updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/bookings/:id/status', authenticate, authorize('broker', 'driver', 'admin'), updateBookingStatusValidation, validate, updateBookingStatus);

/**
 * @swagger
 * /api/bookings/{id}/cancel:
 *   patch:
 *     tags: [Bookings]
 *     summary: Cancel a booking (client/admin)
 *     description: Only allowed while status is pending/confirmed/assigned — otherwise responds 409. Sets status to cancelled and payment_status to refunded (no real refund is triggered — Razorpay integration is out of scope), and appends a cancelled timeline entry.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Booking cancelled
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Booking is no longer cancellable (already past assigned)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/bookings/:id/cancel', authenticate, authorize('client', 'admin'), cancelBooking);

/**
 * @swagger
 * /api/bookings/{id}/pay:
 *   patch:
 *     tags: [Bookings]
 *     summary: Settle a Pay Later booking (client)
 *     description: Marks payment_status as paid. Only allowed while payment_status is pending and the booking isn't cancelled. No real payment gateway is wired up — this just records that the client paid.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Booking UUID or booking_number
 *         schema: { type: string, example: 'BKG-202412-001' }
 *     responses:
 *       200:
 *         description: Payment recorded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Booking is cancelled, or already paid/refunded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/bookings/:id/pay', authenticate, authorize('client'), payBooking);

/**
 * @swagger
 * /api/bookings/{id}/rate:
 *   post:
 *     tags: [Bookings]
 *     summary: Rate a completed booking (client)
 *     description: Only allowed once the booking is delivered/completed. One rating per booking — a second attempt returns an error.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [stars]
 *             properties:
 *               stars:  { type: integer, minimum: 1, maximum: 5, example: 5 }
 *               review: { type: string, nullable: true, example: 'Great service, on time delivery.' }
 *     responses:
 *       200:
 *         description: Booking rated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Booking already rated, or not yet delivered/completed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors — stars must be 1-5
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/:id/rate', authenticate, authorize('client'), rateBookingValidation, validate, rateBooking);

/**
 * @swagger
 * /api/pricing/estimate:
 *   post:
 *     tags: [Pricing]
 *     summary: Compute a price quote
 *     description: Returns a breakdown whose shape depends on transport_type/truck_category — see the gap-analysis doc §2.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [truck_category, distance]
 *             properties:
 *               truck_category: { type: string, enum: [small, medium, large, part] }
 *               transport_type: { type: string, enum: [intra, inter], default: intra }
 *               distance: { type: number }
 *               capacity_used_pct: { type: number, description: "Only used for truck_category=part" }
 *     responses:
 *       200:
 *         description: Pricing estimate calculated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/pricing/estimate', authenticate, estimatePricingValidation, validate, estimatePricing);

module.exports = router;
