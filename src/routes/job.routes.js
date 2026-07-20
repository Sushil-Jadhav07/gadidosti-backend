const express = require('express');
const router = express.Router();

const {
  listJobRequests, acceptJobRequest, assignDriver, declineJobRequest,
  counterJobRequest, clientAcceptOffer, clientRejectOffer, clientCounterOffer,
} = require('../controllers/job.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { assignDriverValidation, counterOfferValidation } = require('../validations/job.validation');

/**
 * @swagger
 * /api/jobs/requests:
 *   get:
 *     tags: [Jobs]
 *     summary: List the broker's job requests
 *     description: Job requests never expire — they stay pending until the broker accepts or declines. Each item includes a "N min ago" timestamp.
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
 *         description: Job requests fetched
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
 *                         requests:    { type: array, items: { $ref: '#/components/schemas/JobRequest' } }
 *                         total:       { type: integer }
 *                         page:        { type: integer }
 *                         limit:       { type: integer }
 *                         total_pages: { type: integer }
 */
router.get('/jobs/requests', authenticate, authorize('broker'), listJobRequests);

/**
 * @swagger
 * /api/jobs/requests/{id}/accept:
 *   patch:
 *     tags: [Jobs]
 *     summary: Accept a job request
 *     description: |
 *       Advances the booking to confirmed and notifies the client. Does NOT assign a driver/truck or create the trip yet — call POST /api/jobs/{id}/assign-driver next for that.
 *       Every new booking is broadcast to all verified brokers as a separate job_request row, so accepting is a compare-and-swap: the first broker to accept wins, and every other broker's pending request for the same booking is automatically declined. If another broker won the race a split second earlier, this returns 409.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Job request accepted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Already actioned or expired
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Another broker already accepted this booking first
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/jobs/requests/:id/accept', authenticate, authorize('broker'), acceptJobRequest);

/**
 * @swagger
 * /api/jobs/{id}/assign-driver:
 *   post:
 *     tags: [Jobs]
 *     summary: Assign a driver + truck to an accepted job request
 *     description: |
 *       Job request must belong to this broker and already be in `accepted` status (call accept first).
 *       driverId must be a driver_profiles row owned by this broker; truckId must be a truck owned by this
 *       broker and currently `available`. On success: booking -> status `assigned` (+ timeline entry),
 *       truck -> `on_trip`, a trips row is created with the booking's pickup/drop/cargo details,
 *       initial trip_timeline steps (Pickup/In Transit/Delivered, done=false) are inserted, and the
 *       driver is notified.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: Job request ID
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driverId: { type: string, format: uuid }
 *               truckId:  { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Driver assigned — returns the updated booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your job request
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Job request, booking, driver, or truck not found (or driver/truck don't belong to this broker)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Job request isn't accepted yet, or the truck isn't available
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors — driverId/truckId missing or not a UUID
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/jobs/:id/assign-driver', authenticate, authorize('broker'), assignDriverValidation, validate, assignDriver);

/**
 * @swagger
 * /api/jobs/requests/{id}/decline:
 *   patch:
 *     tags: [Jobs]
 *     summary: Decline a job request
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Job request declined
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
 *                         request: { $ref: '#/components/schemas/JobRequest' }
 *       400:
 *         description: Already actioned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/jobs/requests/:id/decline', authenticate, authorize('broker'), declineJobRequest);

/**
 * @swagger
 * /api/jobs/requests/{id}/counter:
 *   patch:
 *     tags: [Jobs]
 *     summary: Broker submits a counter-offer (negotiation)
 *     description: |
 *       Only allowed while the request is awaiting the broker's response (status `pending` — either
 *       fresh off the broadcast, or after the client countered back). Sets the request's amount to
 *       the broker's counter, appends it to offer_history, and flips status to `countered` so the
 *       client can accept/reject/counter next via GET /api/bookings/{bookingId}/offers.
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
 *               amount: { type: number, minimum: 1 }
 *               note:   { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Counter-offer sent
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
 *                         request: { $ref: '#/components/schemas/JobRequest' }
 *       400:
 *         description: Not awaiting the broker's response, or already actioned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/jobs/requests/:id/counter', authenticate, authorize('broker'), counterOfferValidation, validate, counterJobRequest);

/**
 * @swagger
 * /api/jobs/requests/{id}/client-accept:
 *   patch:
 *     tags: [Jobs]
 *     summary: Client accepts a broker's counter-offer
 *     description: Only allowed while status is `countered`. Confirms the booking with this broker at the negotiated amount and auto-declines every other pending/countered offer for the same booking — same compare-and-swap guarantee as the broker-side accept.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Offer accepted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Booking is no longer available
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/jobs/requests/:id/client-accept', authenticate, authorize('client'), clientAcceptOffer);

/**
 * @swagger
 * /api/jobs/requests/{id}/client-reject:
 *   patch:
 *     tags: [Jobs]
 *     summary: Client rejects a broker's counter-offer
 *     description: Only allowed while status is `countered`. Declines this specific broker's offer — other brokers' offers on the same booking are unaffected.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Offer declined
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
 *                         request: { $ref: '#/components/schemas/JobRequest' }
 */
router.patch('/jobs/requests/:id/client-reject', authenticate, authorize('client'), clientRejectOffer);

/**
 * @swagger
 * /api/jobs/requests/{id}/client-counter:
 *   patch:
 *     tags: [Jobs]
 *     summary: Client counters a broker's offer back
 *     description: Only allowed while status is `countered`. Sets the request's amount to the client's counter, appends it to offer_history, and flips status back to `pending` so that broker can accept/decline/counter again.
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
 *               amount: { type: number, minimum: 1 }
 *               note:   { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: Counter-offer sent
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
 *                         request: { $ref: '#/components/schemas/JobRequest' }
 */
router.patch('/jobs/requests/:id/client-counter', authenticate, authorize('client'), counterOfferValidation, validate, clientCounterOffer);

module.exports = router;
