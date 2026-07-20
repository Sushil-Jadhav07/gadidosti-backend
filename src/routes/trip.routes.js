const express = require('express');
const router = express.Router();

const {
  listTrips, getActiveTrip, getUpcomingTrip, getTrip, updateTripStatus, declineTrip, updateTripLocation,
  reportIssue, listIncidents, resolveIncident, updateMechanicRequest, uploadPod, getPodFile,
} = require('../controllers/trip.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const idempotent = require('../middleware/idempotency.middleware');
const upload = require('../middleware/upload.middleware');
const {
  updateTripStatusValidation, updateTripLocationValidation, reportIssueValidation, resolveIncidentValidation,
  updateMechanicRequestValidation,
} = require('../validations/trip.validation');

/**
 * @swagger
 * /api/trips:
 *   get:
 *     tags: [Trips]
 *     summary: List trips (role-scoped)
 *     description: broker/driver -> own trips only, admin -> all trips. Each item uses the same rich projection as GET /api/trips/{id}.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [confirmed, en_route_pickup, picked_up, in_transit, delivered, completed, cancelled] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Trips fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/trips', authenticate, authorize('broker', 'driver', 'admin'), listTrips);

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
 *       - in: header
 *         name: Idempotency-Key
 *         required: false
 *         description: Optional. A duplicate key + same user replays the original response instead of re-applying the status change.
 *         schema: { type: string }
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
router.patch('/trips/:id/status', authenticate, authorize('broker', 'driver', 'admin'), idempotent('PATCH /trips/:id/status'), updateTripStatusValidation, validate, updateTripStatus);

/**
 * @swagger
 * /api/trips/{id}/decline:
 *   post:
 *     tags: [Trips]
 *     summary: Driver declines a trip before starting it
 *     description: Only allowed while the trip is still 'confirmed' (not yet started). Frees the driver/truck, clears the assignment on the booking so the broker can assign someone else, and deletes the trip row. Once en route to pickup or beyond, use report-issue instead.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Trip declined
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Trip already started
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/trips/:id/decline', authenticate, authorize('driver'), declineTrip);

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
 * /api/trips/{id}/report-issue:
 *   post:
 *     tags: [Trips]
 *     summary: Report a mid-trip incident (driver only)
 *     description: Only allowed while the trip is active (confirmed/en_route_pickup/picked_up/in_transit). Creates a trip_incidents row and immediately notifies the trip's broker and the booking's client.
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
 *               reason: { type: string, enum: [accident, breakdown, traffic_block, medical, other] }
 *               notes: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Incident reported
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
 *                         incident: { $ref: '#/components/schemas/TripIncident' }
 *       403:
 *         description: Not your trip
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Trip is not in an active state
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/trips/:id/report-issue', authenticate, authorize('driver'), reportIssueValidation, validate, reportIssue);

/**
 * @swagger
 * /api/trips/{id}/incidents:
 *   get:
 *     tags: [Trips]
 *     summary: List incidents reported on a trip
 *     description: Accessible by the trip's broker, driver, client (via the owning booking), or admin.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Incidents fetched
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
 *                         incidents: { type: array, items: { $ref: '#/components/schemas/TripIncident' } }
 *       403:
 *         description: No access to this trip
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/trips/:id/incidents', authenticate, listIncidents);

/**
 * @swagger
 * /api/trips/{id}/incidents/{incidentId}/resolve:
 *   patch:
 *     tags: [Trips]
 *     summary: Mark a trip incident resolved (broker or admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: incidentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string, example: 'Backup truck dispatched, driver swapped.' }
 *     responses:
 *       200:
 *         description: Incident resolved
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
 *                         incident: { $ref: '#/components/schemas/TripIncident' }
 *       404:
 *         description: Incident not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Incident already resolved
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/trips/:id/incidents/:incidentId/resolve', authenticate, authorize('broker', 'admin'), resolveIncidentValidation, validate, resolveIncident);

/**
 * @swagger
 * /api/trips/{id}/incidents/{incidentId}/mechanic:
 *   patch:
 *     tags: [Trips]
 *     summary: Update the mechanic dispatch status for a breakdown incident (broker or admin only)
 *     description: |
 *       Only valid for incidents reported with reason='breakdown' — every such incident gets a linked
 *       mechanic_requests row automatically when the driver reports it. Lets the broker track "mechanic
 *       arranged" / "in progress" before fully closing the incident. Setting status to 'resolved' here
 *       also resolves the underlying trip_incidents row, same as the generic resolve endpoint above.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: path
 *         name: incidentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:         { type: string, enum: [requested, mechanic_assigned, in_progress, resolved] }
 *               mechanicName:   { type: string, nullable: true }
 *               mechanicPhone:  { type: string, nullable: true }
 *               notes:          { type: string, nullable: true, description: "Broker's dispatch notes — separate from the driver's original report notes" }
 *     responses:
 *       200:
 *         description: Mechanic request updated — returns the full incident (with the updated mechanicRequest nested inside)
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
 *                         incident: { $ref: '#/components/schemas/TripIncident' }
 *       400:
 *         description: This incident has no linked mechanic request (not a breakdown)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Incident not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/trips/:id/incidents/:incidentId/mechanic', authenticate, authorize('broker', 'admin'), updateMechanicRequestValidation, validate, updateMechanicRequest);

/**
 * @swagger
 * /api/trips/{id}/pod:
 *   post:
 *     tags: [Trips]
 *     summary: Upload proof of delivery (driver only)
 *     description: Multipart upload — same pattern as POST /api/kyc/documents/upload. Only the assigned driver may upload, and only while the trip is in_transit or delivered. The stored file's URL is saved on trips.pod_url.
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
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Proof of delivery uploaded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your trip
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Trip is not in_transit or delivered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: No file uploaded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/trips/:id/pod', authenticate, authorize('driver'), upload.single('file'), uploadPod);

/**
 * @swagger
 * /api/trips/pod/file/{id}:
 *   get:
 *     tags: [Trips]
 *     summary: Serve a proof-of-delivery file (STORAGE_PROVIDER=postgres only)
 *     description: Mirrors GET /api/kyc/documents/file/{id}. Visible to anyone who can view the trip (client/broker/driver/admin).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: File bytes
 *       403:
 *         description: No access to this file
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: File not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/trips/pod/file/:id', authenticate, getPodFile);

module.exports = router;
