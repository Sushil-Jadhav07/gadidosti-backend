const express = require('express');
const router = express.Router();

const { listJobRequests, acceptJobRequest, declineJobRequest } = require('../controllers/job.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/jobs/requests:
 *   get:
 *     tags: [Jobs]
 *     summary: List the broker's job requests
 *     description: Requests past their expiry are auto-marked expired before the list is returned. Each item includes expiresIn (minutes) and a "N min ago" timestamp.
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
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/jobs/requests', authenticate, authorize('broker'), listJobRequests);

/**
 * @swagger
 * /api/jobs/requests/{id}/accept:
 *   patch:
 *     tags: [Jobs]
 *     summary: Accept a job request
 *     description: Creates the trips row for the booking, marks the request accepted, and notifies the client.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               driver_id: { type: string, format: uuid }
 *               truck_id: { type: string, format: uuid }
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
 */
router.patch('/jobs/requests/:id/accept', authenticate, authorize('broker'), acceptJobRequest);

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
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Already actioned
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/jobs/requests/:id/decline', authenticate, authorize('broker'), declineJobRequest);

module.exports = router;
