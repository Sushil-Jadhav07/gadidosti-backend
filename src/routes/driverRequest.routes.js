const express = require('express');
const router = express.Router();

const {
  acceptDriverRequest, declineDriverRequest, counterDriverRequest,
  clientAcceptDriverRequest, clientRejectDriverRequest, clientCounterDriverRequest,
  listDriverRequests, getDriverRequest, getDriverRequestForBooking,
} = require('../controllers/driverRequest.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { driverCounterOfferValidation } = require('../validations/driverRequest.validation');

/**
 * @swagger
 * /api/driver-requests:
 *   get:
 *     tags: [Driver Requests]
 *     summary: List driver requests (driver -> addressed to them, broker -> ones their driver timed out on)
 *     description: A broker's list only ever shows requests where the driver has already timed out (driver_timeout_at set) — nothing to act on before then, so the rest of their fleet's inbox isn't shown here.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Driver requests fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/driver-requests', authenticate, authorize('driver', 'broker'), listDriverRequests);

/**
 * @swagger
 * /api/driver-requests/booking/{bookingId}:
 *   get:
 *     tags: [Driver Requests]
 *     summary: Get the most recent driver request for a booking (client/driver/broker who's party to it, or admin)
 *     description: Lets a client discover a driver request they didn't create themselves — the broker-assign origin is created by the broker, so the client has no id to look it up by otherwise.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Driver request fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: You do not have access to this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: No driver request found for this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/driver-requests/booking/:bookingId', authenticate, getDriverRequestForBooking);

/**
 * @swagger
 * /api/driver-requests/{id}:
 *   get:
 *     tags: [Driver Requests]
 *     summary: Get a single driver request (client/driver/broker who's party to it, or admin)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Driver request fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: You do not have access to this request
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Driver request not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/driver-requests/:id', authenticate, getDriverRequest);

/**
 * @swagger
 * /api/driver-requests/{id}/accept:
 *   patch:
 *     tags: [Driver Requests]
 *     summary: Accept at the current amount (driver — or broker, once the driver has timed out)
 *     description: Only whoever's turn it currently is may call this — the driver while their response window is open, the broker only after the timeout sweep has flagged it (driver locked out from then on). Accepting doesn't confirm the booking yet — the client still has to call client-accept.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Accepted — awaiting client confirmation
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Request is not awaiting your response
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Not yours to respond to
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/driver-requests/:id/accept', authenticate, authorize('driver', 'broker'), acceptDriverRequest);

/**
 * @swagger
 * /api/driver-requests/{id}/decline:
 *   patch:
 *     tags: [Driver Requests]
 *     summary: Decline (driver — or broker, once the driver has timed out)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Declined
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Request is not awaiting your response
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Not yours to respond to
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/driver-requests/:id/decline', authenticate, authorize('driver', 'broker'), declineDriverRequest);

/**
 * @swagger
 * /api/driver-requests/{id}/counter:
 *   patch:
 *     tags: [Driver Requests]
 *     summary: Counter with a different amount (driver — or broker, once the driver has timed out)
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
 *             required: [amount]
 *             properties:
 *               amount: { type: number }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Counter-offer sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not yours to respond to
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/driver-requests/:id/counter', authenticate, authorize('driver', 'broker'), driverCounterOfferValidation, validate, counterDriverRequest);

/**
 * @swagger
 * /api/driver-requests/{id}/client-accept:
 *   patch:
 *     tags: [Driver Requests]
 *     summary: Confirm the booking at the current amount (client)
 *     description: The real confirmation step — assigns the driver+truck to the booking, creates the trip, and notifies both driver and broker, all in one call (unlike the broker-broadcast flow, no separate assign-driver step is needed since the truck was already hand-picked).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Booking confirmed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Request is not awaiting your response
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: This booking is no longer available (won some other way first)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/driver-requests/:id/client-accept', authenticate, authorize('client'), clientAcceptDriverRequest);

/**
 * @swagger
 * /api/driver-requests/{id}/client-reject:
 *   patch:
 *     tags: [Driver Requests]
 *     summary: Reject this offer (client)
 *     description: The booking itself is left untouched (still 'pending') — pick a different truck via GET /api/vehicles/trucks/nearby and POST /api/bookings/{id}/request-truck again.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Declined
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Request is not awaiting your response
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/driver-requests/:id/client-reject', authenticate, authorize('client'), clientRejectDriverRequest);

/**
 * @swagger
 * /api/driver-requests/{id}/client-counter:
 *   patch:
 *     tags: [Driver Requests]
 *     summary: Propose a different amount back (client)
 *     description: Resets the driver's response window (driver_timeout_at cleared) — even if the broker had taken over, the driver gets a fresh turn to respond to this new number.
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
 *             required: [amount]
 *             properties:
 *               amount: { type: number }
 *               note: { type: string }
 *     responses:
 *       200:
 *         description: Counter-offer sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/driver-requests/:id/client-counter', authenticate, authorize('client'), driverCounterOfferValidation, validate, clientCounterDriverRequest);

module.exports = router;
