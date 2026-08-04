const express = require('express');
const router = express.Router();

const { createBooking, validateLocation } = require('../controllers/booking.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const idempotent = require('../middleware/idempotency.middleware');
const { createBookingValidation } = require('../validations/booking.validation');

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

module.exports = router;
