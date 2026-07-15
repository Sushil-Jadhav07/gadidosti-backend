const express = require('express');
const router = express.Router();

const { getDashboard, getAdminAnalytics, getSettings, updateSettings, listOpenIncidents } = require('../controllers/admin.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { updateSettingsValidation } = require('../validations/admin.validation');

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     tags: [Admin Analytics]
 *     summary: Dashboard summary stats (admin only)
 *     description: Counts are all-time; *Change fields compare the last 30 days of new records against the prior 30 days.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/dashboard', authenticate, authorize('admin'), getDashboard);

/**
 * @swagger
 * /api/admin/incidents:
 *   get:
 *     tags: [Admin Analytics]
 *     summary: List open (unresolved) trip incidents platform-wide (admin only)
 *     description: Unlike GET /api/trips/{id}/incidents (scoped to one known trip), this surfaces every open incident with its trip/booking/driver/broker context so admin can discover problems without already knowing a trip ID. Resolve via the existing PATCH /api/trips/{id}/incidents/{incidentId}/resolve.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *     responses:
 *       200:
 *         description: Open incidents fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/incidents', authenticate, authorize('admin'), listOpenIncidents);

/**
 * @swagger
 * /api/analytics/admin:
 *   get:
 *     tags: [Admin Analytics]
 *     summary: Chart-series analytics for the admin dashboard (admin only)
 *     description: Returns gmvOverMonths, revenueOverMonths, topClients, fleetUtilization, bookingConversionSparkline (last 12 days of booking counts).
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Admin analytics fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/analytics/admin', authenticate, authorize('admin'), getAdminAnalytics);

/**
 * @swagger
 * /api/admin/settings:
 *   get:
 *     tags: [Admin Analytics]
 *     summary: Get platform settings (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Settings fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/settings', authenticate, authorize('admin'), getSettings);

/**
 * @swagger
 * /api/admin/settings:
 *   put:
 *     tags: [Admin Analytics]
 *     summary: Update platform settings (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateSettingsRequest' }
 *     responses:
 *       200:
 *         description: Settings updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.put('/admin/settings', authenticate, authorize('admin'), updateSettingsValidation, validate, updateSettings);

module.exports = router;
