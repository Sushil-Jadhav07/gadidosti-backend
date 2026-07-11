const express = require('express');
const router = express.Router();

const { updateServiceCity, updateAvailability } = require('../controllers/broker.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { updateServiceCityValidation, updateAvailabilityValidation } = require('../validations/broker.validation');

/**
 * @swagger
 * /api/broker/service-city:
 *   patch:
 *     tags: [Broker]
 *     summary: Set the broker's service city (broker only)
 *     description: Used to narrow which new bookings get broadcast to this broker — see POST /api/bookings. Falls back to broadcasting to all active brokers if zero brokers match a booking's pickup city.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [service_city]
 *             properties:
 *               service_city: { type: string, example: 'Mumbai' }
 *     responses:
 *       200:
 *         description: Service city updated
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
 *                         profile: { $ref: '#/components/schemas/BrokerProfile' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/broker/service-city', authenticate, authorize('broker'), updateServiceCityValidation, validate, updateServiceCity);

/**
 * @swagger
 * /api/broker/availability:
 *   patch:
 *     tags: [Broker]
 *     summary: Toggle the broker's online/offline status (broker only)
 *     description: While offline, this broker is excluded from new booking job-request broadcasts (see POST /api/bookings).
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [is_online]
 *             properties:
 *               is_online: { type: boolean, example: false }
 *     responses:
 *       200:
 *         description: Availability updated
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
 *                         profile: { $ref: '#/components/schemas/BrokerProfile' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/broker/availability', authenticate, authorize('broker'), updateAvailabilityValidation, validate, updateAvailability);

module.exports = router;
