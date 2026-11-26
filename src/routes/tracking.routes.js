const express = require('express');
const router = express.Router();

const { listDevices, getDeviceByName, getDeviceByImei, linkDeviceToTruck } = require('../controllers/tracking.controller');
const { authenticate, authorize, requireAdminPage } = require('../middleware/auth.middleware');
const { linkDeviceToTruckValidation } = require('../validations/tracking.validation');
const validate = require('../middleware/validate.middleware');

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
router.get('/tracking/devices', authenticate, authorize('admin', 'staff', 'gps_owner'), requireAdminPage('tracking'), listDevices);

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
router.get('/tracking/devices/name/:name', authenticate, authorize('admin', 'staff', 'gps_owner'), requireAdminPage('tracking'), getDeviceByName);

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
router.get('/tracking/devices/imei/:imei', authenticate, authorize('admin', 'staff', 'gps_owner'), requireAdminPage('tracking'), getDeviceByImei);

/**
 * @swagger
 * /api/tracking/devices/{imei}/link-truck:
 *   patch:
 *     tags: [Tracking]
 *     summary: Link (or, with registration omitted, unlink) a GPS tracker to one of our trucks (admin/staff only)
 *     description: Looks the truck up by registration number — there's no separate truck picker. gps_owner accounts cannot call this; their own visibility is scoped separately via PATCH /api/admin/users/{id}/gps-trucks.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: imei
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               registration: { type: string, description: "Omit or send empty to unlink whatever truck currently has this device" }
 *     responses:
 *       200:
 *         description: Device linked/unlinked
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: No truck found with this registration number
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: This device is already linked to another truck
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
// admin/staff only — gps_owner's own visibility is scoped separately (Users.jsx's Truck Access
// editor), and must never be self-expandable by relinking devices onto new trucks.
router.patch('/tracking/devices/:imei/link-truck', authenticate, authorize('admin', 'staff'), requireAdminPage('tracking'), linkDeviceToTruckValidation, validate, linkDeviceToTruck);

module.exports = router;
