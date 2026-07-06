const express = require('express');
const router = express.Router();

const {
  createTruck, listTrucks, getTruck, updateTruck, deleteTruck,
  createDriver, listDrivers, getDriver, updateDriver,
} = require('../controllers/vehicle.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createTruckValidation, updateTruckValidation, createDriverValidation, updateDriverValidation,
} = require('../validations/vehicle.validation');

// ─── TRUCKS ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicles/trucks:
 *   post:
 *     tags: [Vehicles]
 *     summary: Add a truck (broker)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateTruckRequest' }
 *     responses:
 *       201:
 *         description: Truck added
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Registration already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/trucks', authenticate, authorize('broker'), createTruckValidation, validate, createTruck);

/**
 * @swagger
 * /api/vehicles/trucks:
 *   get:
 *     tags: [Vehicles]
 *     summary: List trucks (broker -> own, admin -> all)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, on_trip, maintenance] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Trucks fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/vehicles/trucks', authenticate, authorize('broker', 'admin'), listTrucks);

/**
 * @swagger
 * /api/vehicles/trucks/{id}:
 *   get:
 *     tags: [Vehicles]
 *     summary: Get a truck by ID
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Truck fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Truck not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/vehicles/trucks/:id', authenticate, authorize('broker', 'admin'), getTruck);

/**
 * @swagger
 * /api/vehicles/trucks/{id}:
 *   patch:
 *     tags: [Vehicles]
 *     summary: Update a truck
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
 *           schema: { $ref: '#/components/schemas/UpdateTruckRequest' }
 *     responses:
 *       200:
 *         description: Truck updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Truck not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/vehicles/trucks/:id', authenticate, authorize('broker', 'admin'), updateTruckValidation, validate, updateTruck);

/**
 * @swagger
 * /api/vehicles/trucks/{id}:
 *   delete:
 *     tags: [Vehicles]
 *     summary: Delete a truck
 *     description: Hard delete — rejected with 400 if any booking has ever referenced this truck (use status=maintenance instead).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Truck deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Truck has booking history
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Truck not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/vehicles/trucks/:id', authenticate, authorize('broker', 'admin'), deleteTruck);

// ─── DRIVERS ──────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicles/drivers:
 *   post:
 *     tags: [Vehicles]
 *     summary: Create a driver profile for an existing driver-role user (broker)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateDriverRequest' }
 *     responses:
 *       201:
 *         description: Driver profile created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Driver profile already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/drivers', authenticate, authorize('broker'), createDriverValidation, validate, createDriver);

/**
 * @swagger
 * /api/vehicles/drivers:
 *   get:
 *     tags: [Vehicles]
 *     summary: List drivers (broker -> own, admin -> all)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [available, on_trip, offline] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: Drivers fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/vehicles/drivers', authenticate, authorize('broker', 'admin'), listDrivers);

/**
 * @swagger
 * /api/vehicles/drivers/{id}:
 *   get:
 *     tags: [Vehicles]
 *     summary: Get a driver profile by user ID
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Driver fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Driver profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/vehicles/drivers/:id', authenticate, authorize('broker', 'admin'), getDriver);

/**
 * @swagger
 * /api/vehicles/drivers/{id}:
 *   patch:
 *     tags: [Vehicles]
 *     summary: Update a driver profile
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
 *           schema: { $ref: '#/components/schemas/UpdateDriverRequest' }
 *     responses:
 *       200:
 *         description: Driver updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Driver profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/vehicles/drivers/:id', authenticate, authorize('broker', 'admin'), updateDriverValidation, validate, updateDriver);

module.exports = router;
