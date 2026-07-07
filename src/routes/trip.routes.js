const express = require('express');
const router = express.Router();

const { getActiveTrip, getUpcomingTrip, getTrip, updateTripStatus, updateTripLocation, uploadPod } = require('../controllers/trip.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { updateTripStatusValidation, updateTripLocationValidation } = require('../validations/trip.validation');

/**
 * @swagger
 * /api/trips/active:
 *   get:
 *     tags: [Trips]
 *     summary: Get the driver's current in-progress trip
 *     description: Returns the richest shape in the API — nested pickup/drop/cargo objects, earnings, currentLocation. Returns { trip null } if there is none.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Active trip fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/trips/active', authenticate, authorize('driver'), getActiveTrip);

/**
 * @swagger
 * /api/trips/upcoming:
 *   get:
 *     tags: [Trips]
 *     summary: Get the driver's next assigned trip that hasn't started yet
 *     description: Status still 'confirmed' — distinct from /trips/active, which only returns a trip once it's in progress. Never returns the same trip as /trips/active. Returns { trip null } if there is none.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Upcoming trip fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/trips/upcoming', authenticate, authorize('driver'), getUpcomingTrip);

/**
 * @swagger
 * /api/trips/{id}:
 *   get:
 *     tags: [Trips]
 *     summary: Get a trip by ID
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Trip fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: No access to this trip
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Trip not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/trips/:id', authenticate, authorize('broker', 'driver', 'admin'), getTrip);

/**
 * @swagger
 * /api/trips/{id}/status:
 *   patch:
 *     tags: [Trips]
 *     summary: Advance a trip's status
 *     description: Appends a trip_timeline entry and mirrors the status onto the parent booking. Marking delivered/completed creates a pending settlement and increments the driver's total_trips.
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
 *               status: { type: string, enum: [confirmed, en_route_pickup, picked_up, in_transit, delivered, completed, cancelled] }
 *     responses:
 *       200:
 *         description: Trip status updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.patch('/trips/:id/status', authenticate, authorize('broker', 'driver', 'admin'), updateTripStatusValidation, validate, updateTripStatus);

/**
 * @swagger
 * /api/trips/{id}/location:
 *   patch:
 *     tags: [Trips]
 *     summary: Update the driver's live location for a trip
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
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number }
 *               lng: { type: number }
 *     responses:
 *       200:
 *         description: Location updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.patch('/trips/:id/location', authenticate, authorize('driver'), updateTripLocationValidation, validate, updateTripLocation);

/**
 * @swagger
 * /api/trips/{id}/pod:
 *   post:
 *     tags: [Trips]
 *     summary: Upload proof of delivery (not yet configured)
 *     description: No object storage provider is configured yet — always returns 501, matching the KYC document-upload stub.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       501:
 *         description: Not configured
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/trips/:id/pod', authenticate, authorize('driver'), uploadPod);

module.exports = router;
