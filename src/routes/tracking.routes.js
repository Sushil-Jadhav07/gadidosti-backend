const express = require('express');
const router = express.Router();

const { listDevices, getDeviceByName, getDeviceByImei } = require('../controllers/tracking.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

/**
 * @swagger
 * /api/tracking/devices:
 *   get:
 *     tags: [Tracking]
 *     summary: List every GPS tracker device on the account (admin only)
 *     description: Proxies Roadcast's Bolt Pull API "All Devices" endpoint.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Devices fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       502:
 *         description: Failed to fetch devices from the tracking provider
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/tracking/devices', authenticate, authorize('admin'), listDevices);

/**
 * @swagger
 * /api/tracking/devices/name/{name}:
 *   get:
 *     tags: [Tracking]
 *     summary: Get a single tracker device by its name (any authenticated role)
 *     description: Proxies Roadcast's Bolt Pull API "Single Device by Name" endpoint.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Device fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Device not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/tracking/devices/name/:name', authenticate, getDeviceByName);

/**
 * @swagger
 * /api/tracking/devices/imei/{imei}:
 *   get:
 *     tags: [Tracking]
 *     summary: Get a single tracker device by its vehicle IMEI (any authenticated role)
 *     description: Proxies Roadcast's Bolt Pull API "Single Device By IMEI" endpoint.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: imei
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Device fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Device not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/tracking/devices/imei/:imei', authenticate, getDeviceByImei);

module.exports = router;
