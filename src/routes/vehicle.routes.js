const express = require('express');
const router = express.Router();

const {
  createTruck, listTrucks, listNearbyTrucks, getTruck, updateTruck, assignDriverToTruck, deleteTruck,
  lookupDriverByPhone, createDriver, registerDriver, listDrivers, listActiveDrivers, getDriver, updateDriver, deleteDriver,
  myAssignedTruck, updateDriverLocation, uploadPaymentQr,
} = require('../controllers/vehicle.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const upload = require('../middleware/upload.middleware');
const {
  createTruckValidation, updateTruckValidation, createDriverValidation, updateDriverValidation,
  registerDriverValidation, updateDriverLocationValidation, assignDriverValidation, nearbyTrucksValidation,
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
 * /api/vehicles/trucks/nearby:
 *   get:
 *     tags: [Vehicles]
 *     summary: Available trucks near a pickup point, with driver live GPS (any authenticated role)
 *     description: |
 *       Powers the Truck-selection step of booking creation — shows available trucks (status=available, with an available, KYC-verified driver actually assigned to it, who has reported a location) near the client's pickup point, before any broker/driver is assigned to the booking. Platform-wide, not scoped to one broker.
 *
 *       No driver name/phone is included — nobody has been assigned to this client's booking yet. Each result includes the driver's live current_lat/current_lng and last_location_at so the frontend can plot it on a map; there's no push/socket channel for movement — join the `truck:{truckId}` Socket.IO room (event `join-truck-tracking`) for each returned truck to get live `truck-location` push updates instead of polling.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: pickup_lat
 *         required: true
 *         schema: { type: number, example: 19.076 }
 *       - in: query
 *         name: pickup_lng
 *         required: true
 *         schema: { type: number, example: 72.8777 }
 *       - in: query
 *         name: truck_category
 *         schema: { type: string, enum: [small, medium, large, part] }
 *       - in: query
 *         name: capacity
 *         description: Matches the truck's freeform capacity field exactly (case-insensitive) — pass whatever the user picked on the Truck step (e.g. "5" or "5 Tons"), matching the value shown on the category card.
 *         schema: { type: string, example: "5 Tons" }
 *       - in: query
 *         name: radius_km
 *         description: Only trucks within this many km of the pickup point are returned. Omit for no radius cap (still sorted nearest-first).
 *         schema: { type: number }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Nearby trucks fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: pickup_lat/pickup_lng missing or invalid
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/vehicles/trucks/nearby', authenticate, nearbyTrucksValidation, validate, listNearbyTrucks);

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
 * /api/vehicles/trucks/{id}/assign-driver:
 *   post:
 *     tags: [Vehicles]
 *     summary: Assign a driver to an existing truck (broker, or admin)
 *     description: Links driver_id on the truck and truck_id on the driver profile together in one step. If the driver is already on a different truck, or this truck already has a different driver, the old link is cleared automatically so neither ever ends up double-assigned.
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
 *             required: [driver_id]
 *             properties:
 *               driver_id: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Driver assigned to truck
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       403:
 *         description: Not your truck
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Truck or driver not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Driver and truck belong to different brokers
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/trucks/:id/assign-driver', authenticate, authorize('broker', 'admin'), assignDriverValidation, validate, assignDriverToTruck);

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
 * /api/vehicles/drivers/active:
 *   get:
 *     tags: [Vehicles]
 *     summary: List active drivers with full truck details (any authenticated role)
 *     description: Platform-wide, not scoped to a broker's own fleet — returns every driver whose status isn't 'offline', together with their assigned truck's full details (or null if unassigned). Intended for driver-picker style UIs.
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
 *         description: Active drivers fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/vehicles/drivers/active', authenticate, listActiveDrivers);

/**
 * @swagger
 * /api/vehicles/drivers/me/truck:
 *   get:
 *     tags: [Vehicles]
 *     summary: Get the authenticated driver's own assigned truck (driver)
 *     description: Single truck object (or null if unassigned) — driver_profiles.truck_id is a single FK, a driver is assigned to at most one truck at a time. Same full truck shape as GET /api/vehicles/trucks/{id}.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Assigned truck fetched (truck may be null)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Driver profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/vehicles/drivers/me/truck', authenticate, authorize('driver'), myAssignedTruck);

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
 * /api/vehicles/drivers/me/payment-qr:
 *   post:
 *     tags: [Vehicles]
 *     summary: Upload/replace the authenticated driver's personal UPI QR (driver)
 *     description: Uploaded once, reused across every trip's Payments step — re-uploading replaces the saved image.
 *     security:
 *       - BearerAuth: []
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
 *         description: Payment QR uploaded
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
 *                         paymentQrUrl: { type: string }
 *       404:
 *         description: Driver profile not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: No file uploaded
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/vehicles/drivers/me/payment-qr', authenticate, authorize('driver'), upload.single('file'), uploadPaymentQr);

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
