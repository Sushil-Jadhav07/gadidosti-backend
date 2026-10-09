const express = require('express');
const router = express.Router();

const {
  createTripJoinRequest, acceptTripJoinRequest, declineTripJoinRequest,
  listTripJoinRequests, getTripJoinRequest, getTripJoinRequestForBooking,
} = require('../controllers/tripJoinRequest.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { createTripJoinRequestValidation } = require('../validations/tripJoinRequest.validation');

/**
 * @swagger
 * /api/trip-join-requests:
 *   post:
 *     tags: [Trip Join Requests]
 *     summary: Client requests to join a specific on-trip truck for a part-load booking
 *     description: The booking must already exist (truck_category 'part', search_mode 'part_load') and still be 'pending'. target_trip_id comes from GET /vehicles/trucks/nearby-on-trip's currentTripId. Re-validates the match server-side before creating the request.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [booking_id, target_trip_id]
 *             properties:
 *               booking_id: { type: string, format: uuid }
 *               target_trip_id: { type: string, format: uuid }
 *     responses:
 *       201:
 *         description: Request sent
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Booking not pending, already has a live request, or the match is no longer valid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/trip-join-requests', authenticate, authorize('client'), createTripJoinRequestValidation, validate, createTripJoinRequest);

/**
 * @swagger
 * /api/trip-join-requests:
 *   get:
 *     tags: [Trip Join Requests]
 *     summary: List trip join requests (driver -> addressed to them, broker -> ones their driver timed out on)
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
 *         description: Trip join requests fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/trip-join-requests', authenticate, authorize('driver', 'broker'), listTripJoinRequests);

/**
 * @swagger
 * /api/trip-join-requests/booking/{bookingId}:
 *   get:
 *     tags: [Trip Join Requests]
 *     summary: Look up the (one) trip join request for a part-load booking
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: bookingId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Request fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: No request found for this booking
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/trip-join-requests/booking/:bookingId', authenticate, getTripJoinRequestForBooking);

/**
 * @swagger
 * /api/trip-join-requests/{id}:
 *   get:
 *     tags: [Trip Join Requests]
 *     summary: Fetch one trip join request
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Request fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Request not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/trip-join-requests/:id', authenticate, getTripJoinRequest);

/**
 * @swagger
 * /api/trip-join-requests/{id}/accept:
 *   patch:
 *     tags: [Trip Join Requests]
 *     summary: Driver (or broker, once timed out) accepts a part-load request
 *     description: Creates a second, independent trips row for the joining booking (same driver/truck as the target trip) once re-validated the capacity/route match still holds.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Request accepted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: No longer pending, or the match is no longer valid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/trip-join-requests/:id/accept', authenticate, authorize('driver', 'broker'), acceptTripJoinRequest);

/**
 * @swagger
 * /api/trip-join-requests/{id}/decline:
 *   patch:
 *     tags: [Trip Join Requests]
 *     summary: Driver (or broker, once timed out) declines a part-load request
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Request declined
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: No longer pending
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/trip-join-requests/:id/decline', authenticate, authorize('driver', 'broker'), declineTripJoinRequest);

module.exports = router;
