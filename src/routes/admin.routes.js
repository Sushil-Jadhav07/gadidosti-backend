const express = require('express');
const router = express.Router();

const { getDashboard, getAdminAnalytics, getSettings, updateSettings } = require('../controllers/admin.controller');
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
