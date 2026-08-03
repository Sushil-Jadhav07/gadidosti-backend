const express = require('express');
const router = express.Router();

const { createBooking } = require('../controllers/booking.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const idempotent = require('../middleware/idempotency.middleware');
const { createBookingValidation } = require('../validations/booking.validation');

/**
 * @swagger
 * /api/bookings:
 *   post:
 *     tags: [Bookings]
 *     summary: Create a booking (client)
 *     description: |
 *       No broker or truck is assigned at creation — the booking is broadcast as a job_request to every KYC-verified, active broker. Brokers may counter or decline; the client picks one via PATCH /api/jobs/requests/{id}/client-accept, which confirms the booking and auto-declines every other offer. The winning broker then assigns a driver + truck via POST /api/jobs/{id}/assign-driver.
 *
 *       **transport_type / city rule:** for an **intra-city** booking (transport_type omitted or "intra"), `city` is required — the single city both `pickup_location` and `drop_location` must fall within (checked as a case-insensitive substring match, e.g. city="Indore" matches an address containing "...Indore, Madhya Pradesh..."). For an **inter-city** booking (transport_type "inter"), `city` does not apply and pickup/drop may be in different cities.
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
 *               transport_type: { type: string, enum: [intra, inter], default: intra }
 *               city: { type: string, description: "Required when transport_type is intra (or omitted) — pickup_location and drop_location must both fall within this city. Not used for inter-city bookings." }
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
 *         description: Validation errors — pickup_location/drop_location missing, transport_type invalid, city missing for an intra-city booking, or pickup_location/drop_location not within the given city
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/bookings', authenticate, authorize('client'), idempotent('POST /bookings'), createBookingValidation, validate, createBooking);

module.exports = router;
