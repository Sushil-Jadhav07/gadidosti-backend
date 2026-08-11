const express = require('express');
const router = express.Router();

const { createBooking, validateLocation, quoteBooking, listBookings, getBooking, trackBooking, requestTruckForBooking, cancelBooking, payBooking, deleteBooking, getClientAnalytics } = require('../controllers/booking.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const idempotent = require('../middleware/idempotency.middleware');
const { createBookingValidation, quoteBookingValidation } = require('../validations/booking.validation');
const { requestTruckValidation } = require('../validations/driverRequest.validation');

/**
 * @swagger
 * /api/bookings/validate-location:
 *   post:
 *     tags: [Bookings]
 *     summary: Check the Locations step before letting the user continue (client)
 *     description: |
 *       Stateless — creates nothing. Runs the exact same pickup_location/drop_location/transport_type/city rule as POST /api/bookings (see that endpoint's description), so a 200 here guarantees these same location fields will pass validation on the real POST /api/bookings call later. Call this right after the user fills in the Locations step. Nothing here is required — an empty body is valid too; this only rejects when city is given with transport_type=intra and pickup_location/drop_location don't fall within it.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pickup_location: { type: string }
 *               drop_location: { type: string }
 *               transport_type: { type: string, enum: [intra, inter], default: intra }
 *               city: { type: string, description: "Not required. When given together with transport_type=intra (or omitted) and pickup_location/drop_location, both must fall within it." }
 *     responses:
 *       200:
 *         description: Location is valid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: city missing for an intra-city booking, or pickup_location/drop_location not within the given city
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/validate-location', authenticate, authorize('client'), createBookingValidation, validate, validateLocation);

/**
 * @swagger
 * /api/bookings/quote:
 *   post:
 *     tags: [Bookings]
 *     summary: Preview a price estimate before creating a booking (any authenticated role)
 *     description: Runs the same PricingModel.estimate() calculation POST /api/bookings uses internally when distance is given — call this on the Truck-selection step to show a live price per truck category without creating anything. Reads live from GET /api/admin/pricing's config, so results always match the current admin-configured rates.
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
 *               distance: { type: number, description: "In km" }
 *               capacity_used_pct: { type: number, description: "Only used when truck_category=part" }
 *               duration_min: { type: number, nullable: true, description: "Traffic-free ETA in minutes, from GET /api/config/distance — enables the traffic surge multiplier when given together with duration_in_traffic_min" }
 *               duration_in_traffic_min: { type: number, nullable: true, description: "Live-traffic ETA in minutes, from GET /api/config/distance" }
 *     responses:
 *       200:
 *         description: Pricing estimate calculated — shape depends on truck_category/transport_type (see PricingModel.estimate)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Pricing configuration not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/quote', authenticate, quoteBookingValidation, validate, quoteBooking);

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: Create a booking (client)
 *     description: |
 *       No broker or truck is assigned at creation — the booking is broadcast as a job_request to every KYC-verified, active broker. Brokers may counter or decline; the client picks one via PATCH /api/jobs/requests/{id}/client-accept, which confirms the booking and auto-declines every other offer. The winning broker then assigns a driver + truck via POST /api/jobs/{id}/assign-driver.
 *
 *       **Nothing in this request body is required** — an empty body creates a booking with every field null/default. This is intentional: the frontend wizard collects fields across several steps, and the client may submit before every step is filled in.
 *
 *       **transport_type / city rule (only checked when the relevant fields are present):** for an **intra-city** booking (transport_type omitted or "intra"), if both `city` and `pickup_location`/`drop_location` are given, the locations must fall within that city (checked as a case-insensitive substring match, e.g. city="Indore" matches an address containing "...Indore, Madhya Pradesh..."). For an **inter-city** booking (transport_type "inter"), `city` does not apply.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               pickup_location: { type: string }
 *               pickup_lat: { type: number }
 *               pickup_lng: { type: number }
 *               drop_location: { type: string }
 *               drop_lat: { type: number }
 *               drop_lng: { type: number }
 *               transport_type: { type: string, enum: [intra, inter], default: intra }
 *               city: { type: string, description: "Not required. When given together with transport_type=intra (or omitted) and pickup_location/drop_location, both must fall within it." }
 *               add_loading_location:
 *                 type: array
 *                 description: Extra pickup stops beyond pickup_location, e.g. collecting from more than one warehouse before heading to drop.
 *                 items:
 *                   type: object
 *                   properties:
 *                     location: { type: string }
 *                     lat: { type: number }
 *                     lng: { type: number }
 *               add_unloading_location:
 *                 type: array
 *                 description: Extra drop stops beyond drop_location, e.g. unloading part of the load at more than one point.
 *                 items:
 *                   type: object
 *                   properties:
 *                     location: { type: string }
 *                     lat: { type: number }
 *                     lng: { type: number }
 *               truck_type: { type: string }
 *               truck_category: { type: string, enum: [small, medium, large, part] }
 *               weight: { type: number }
 *               weight_unit: { type: string, default: tons }
 *               quantity: { type: integer }
 *               material: { type: string }
 *               notes: { type: string }
 *               scheduled_date: { type: string, format: date-time }
 *               distance: { type: number, description: "If provided, pricing is auto-computed" }
 *               duration_min: { type: number, nullable: true }
 *               duration_in_traffic_min: { type: number, nullable: true }
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
 *         description: Validation errors — an invalid (not missing) transport_type/lat/lng/array shape, or pickup_location/drop_location not within the given city when city is present
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
 *     summary: List bookings (role-scoped — one endpoint covers client/broker/driver/admin)
 *     description: client -> own bookings, broker -> bookings assigned to them, driver -> bookings assigned to them, admin -> every booking. No separate per-role endpoint exists — the scoping is automatic based on the caller's role.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         description: Comma-separated to match multiple statuses, e.g. "pending,confirmed"
 *         schema: { type: string }
 *       - in: query
 *         name: sort
 *         schema: { type: string, enum: [asc, desc], default: desc }
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
 * /api/bookings/{id}:
 *   get:
 *     tags: [Bookings]
 *     summary: Get a single booking (role-scoped — client/broker/driver see only their own, admin sees any)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Booking fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: You do not have access to this booking
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
 *     summary: Live driver location + ETA for the tracking screen (role-scoped — same access rule as GET /api/bookings/{id})
 *     description: Polled by the frontend every 5-10s — plain lat/lng snapshot, no WebSocket infra. Returns null driverLat/driverLng/lastLocationAt/distanceRemainingKm/etaMinutes until a driver is assigned and has reported a location. Also surfaces the latest unresolved trip incident (if any) so the tracking screen can show a banner without a separate call.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Booking location fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: You do not have access to this booking
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
 * /api/bookings/{id}/request-truck:
 *   post:
 *     tags: [Bookings]
 *     summary: Request a specific truck's driver directly (client)
 *     description: |
 *       Direct-negotiation entry point — parallel to the broker-broadcast flow (POST /api/bookings already does that broadcast automatically), not a replacement. Pick a truck_id from GET /api/vehicles/trucks/nearby and this sends that truck's driver a request at the booking's current amount.
 *
 *       What happens next: the driver can accept/decline/counter via PATCH /api/driver-requests/{id}/accept|decline|counter. If the driver doesn't respond within a few minutes, their broker is notified and can respond in their place (driver locked out from then on). Once someone accepts or counters, the client responds via PATCH /api/driver-requests/{id}/client-accept|client-reject|client-counter — client-accept is the final confirmation: it assigns the driver+truck to the booking and creates the trip immediately (no separate assign-driver step needed, since the truck was already picked).
 *
 *       If the client rejects, the booking stays 'pending' — pick a different truck and call this again.
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
 *             required: [truck_id]
 *             properties:
 *               truck_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Request sent to driver
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Booking or truck not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Booking is no longer pending, or truck is not available / has no driver
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings/:id/request-truck', authenticate, authorize('client'), requestTruckValidation, validate, requestTruckForBooking);

/**
 * @swagger
 * /api/bookings/{id}/cancel:
 *   patch:
 *     tags: [Bookings]
 *     summary: Cancel a booking (client, with a required reason)
 *     description: |
 *       Allowed any time before cargo is picked up — status pending, confirmed, assigned, or
 *       en_route_pickup. Once picked_up or later, use the dispute flow instead (report-a-problem).
 *
 *       On success: booking -> cancelled (payment_status -> refunded if it was paid), every
 *       still-open job_requests/driver_requests offer for it is declined, and if a driver/truck
 *       was already assigned they're freed back to available and the linked trip (if any) is
 *       cancelled too. The driver and broker (whoever is assigned at the time) are notified,
 *       including the reason.
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, description: "Why the client is cancelling — shown to the driver/broker in their notification" }
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
 *         description: Booking can no longer be cancelled (already picked up, delivered, completed, or already cancelled)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: A cancellation reason is required
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/bookings/:id/cancel', authenticate, authorize('client'), cancelBooking);

/**
 * @swagger
 * /api/bookings/{id}/pay:
 *   patch:
 *     tags: [Bookings]
 *     summary: Mark a booking as paid (client)
 *     description: |
 *       No real payment gateway is wired up yet — the client app's PaymentSheet is a simulated
 *       checkout. This just records that payment completed and how, once a driver/broker has
 *       confirmed the booking (or any time after, as a standalone "Pay Now" fallback).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               payment_mode: { type: string, description: "How the client paid — upi/cards/netbanking/wallet, matches the PaymentSheet tab used" }
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
 *         description: Already paid, or booking is cancelled
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/bookings/:id/pay', authenticate, authorize('client'), payBooking);

/**
 * @swagger
 * /api/bookings/{id}:
 *   delete:
 *     tags: [Bookings]
 *     summary: Delete a booking (admin — permanent; broker, or a broker-less driver — hides it from their own list only)
 *     description: |
 *       Two different operations behind one endpoint, split by role:
 *       - **admin**: a real, irreversible delete. Cascades to booking_timeline, job_requests, driver_requests, trips, chat threads, and payment/dispute/settlement rows referencing this booking. No status restriction.
 *       - **broker** (or a **self-registered driver**, who is their own broker_id — a regular driver working under a real broker never matches and gets 403): a soft hide only — the row is untouched, just marked deleted_at, and stays fully visible to admin the whole time. Only allowed while status is `pending`, `cancelled`, or `completed` — an active or just-finished-but-unsettled shipment can't be hidden this way.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Deleted (permanently for admin, hidden-from-own-list for broker/driver)
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
 *         description: Already deleted, or status doesn't allow deletion (broker/driver only)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/bookings/:id', authenticate, authorize('admin', 'broker', 'driver'), deleteBooking);

/**
 * @swagger
 * /api/analytics/client:
 *   get:
 *     tags: [Bookings]
 *     summary: Client dashboard analytics (own bookings only)
 *     description: Client-scoped mirror of GET /api/analytics/admin — activeBookings, delayedBookings, paidInvoices, newBookingsLast7Days, plus a 14-day spendSparkline and a 7-day weeklyBookings series, all filtered to the caller's own bookings.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Client analytics fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/analytics/client', authenticate, authorize('client'), getClientAnalytics);

module.exports = router;
