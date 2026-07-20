const express = require('express');
const router = express.Router();

const {
  createTruck, listTrucks, getTruck, updateTruck, deleteTruck,
  lookupDriverByPhone, createDriver, registerDriver, listDrivers, getDriver, updateDriver, deleteDriver, updateDriverLocation,
} = require('../controllers/vehicle.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  createTruckValidation, updateTruckValidation, createDriverValidation, updateDriverValidation,
  registerDriverValidation, updateDriverLocationValidation,
} = require('../validations/vehicle.validation');

// ─── TRUCKS ───────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/vehicles/trucks:
 *   post:
 *     tags: [Vehicles]
 *     summary: Add a truck (broker, or admin on behalf of a chosen broker)
 *     description: A broker always adds to their own fleet. An admin must pass broker_id explicitly (trucks.broker_id is NOT NULL) — see CreateTruckRequest.
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
 *       404:
 *         description: (Admin caller only) broker_id doesn't match an existing broker
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Registration already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors — registration/type/category/capacity are required, or (admin caller) broker_id is missing
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/trucks', authenticate, authorize('broker', 'admin'), createTruckValidation, validate, createTruck);

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
 *       422:
 *         description: Validation errors
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
 * /api/vehicles/drivers/lookup:
 *   get:
 *     tags: [Vehicles]
 *     summary: Look up a driver-role user by phone number (broker, or admin)
 *     description: Used by the "Add Driver" flow so the caller can find a driver by phone instead of needing their raw user ID. Returns 404 if no driver-role account has that phone, 409 if that driver already has a profile (linked to a broker).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: phone
 *         required: true
 *         schema: { type: string, example: '9876543210' }
 *     responses:
 *       200:
 *         description: Driver found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: No driver account found with this phone number
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Driver already linked to a broker
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Invalid phone number
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/vehicles/drivers/lookup', authenticate, authorize('broker', 'admin'), lookupDriverByPhone);

/**
 * @swagger
 * /api/vehicles/drivers:
 *   post:
 *     tags: [Vehicles]
 *     summary: Create a driver profile for an existing driver-role user (broker, or admin on behalf of a chosen broker)
 *     description: A broker always adds to their own fleet. An admin must pass broker_id explicitly (driver_profiles.broker_id is NOT NULL) — see CreateDriverRequest.
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
 *         description: User not found, or (admin caller) broker_id doesn't match an existing broker
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Driver profile already exists
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: (Admin caller) broker_id is missing
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/drivers', authenticate, authorize('broker', 'admin'), createDriverValidation, validate, createDriver);

/**
 * @swagger
 * /api/vehicles/drivers/register:
 *   post:
 *     tags: [Vehicles]
 *     summary: Register a brand-new driver account and add them to a fleet (broker, or admin on behalf of a chosen broker)
 *     description: Unlike POST /api/vehicles/drivers (which links an existing driver-role account found via phone lookup), this creates the users row itself — for the common case where the driver hasn't signed up on their own. A temporary password is generated and returned once in the response so the caller can relay it to the driver; login is email + password (see SSK broker-driver/app/src/pages/Login.jsx and admin-dashboard/app/src/pages/Drivers.jsx). A broker always adds to their own fleet; an admin must pass broker_id explicitly.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RegisterDriverRequest' }
 *     responses:
 *       201:
 *         description: Driver registered and added to fleet — response includes a one-time tempPassword
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: (Admin caller only) broker_id doesn't match an existing broker
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       409:
 *         description: Phone or email already registered
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors, or (admin caller) broker_id is missing
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/drivers/register', authenticate, authorize('broker', 'admin'), registerDriverValidation, validate, registerDriver);

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
 *       - in: query
 *         name: near_lat
 *         description: When given together with near_lng, ranks drivers by distance from this point instead of created_at.
 *         schema: { type: number }
 *       - in: query
 *         name: near_lng
 *         schema: { type: number }
 *       - in: query
 *         name: truck_type
 *         description: Only used together with near_lat/near_lng — narrows the near-search to a matching truck type.
 *         schema: { type: string }
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
 * /api/vehicles/drivers/me/location:
 *   patch:
 *     tags: [Vehicles]
 *     summary: Update the authenticated driver's current location (driver)
 *     description: Pinged periodically by the driver's app while online, even before a trip starts.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [lat, lng]
 *             properties:
 *               lat: { type: number, example: 19.076 }
 *               lng: { type: number, example: 72.8777 }
 *     responses:
 *       200:
 *         description: Location updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Driver profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/vehicles/drivers/me/location', authenticate, authorize('driver'), updateDriverLocationValidation, validate, updateDriverLocation);

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
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/vehicles/drivers/:id', authenticate, authorize('broker', 'admin'), updateDriverValidation, validate, updateDriver);

/**
 * @swagger
 * /api/vehicles/drivers/{id}:
 *   delete:
 *     tags: [Vehicles]
 *     summary: Remove a driver from the broker's fleet (unlinks driver_profiles; the driver's account is untouched)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Driver removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Driver has booking history
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Driver profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/vehicles/drivers/:id', authenticate, authorize('broker', 'admin'), deleteDriver);

module.exports = router;
