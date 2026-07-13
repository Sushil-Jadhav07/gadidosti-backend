const express = require('express');

const { listVehicleTypes, listMaterialTypes, listCities, getDistance } = require('../controllers/config.controller');

const router = express.Router();

/**
 * @swagger
 * /api/config/vehicle-types:
 *   get:
 *     tags: [Config]
 *     summary: List available truck/vehicle categories
 *     description: |
 *       Public, no auth required. Powers the truck-selection step of the booking form.
 *       `basePrice` is read live from the admin-configured pricing (PUT /api/admin/pricing,
 *       `intraCity.<id>.baseFare`) — it always reflects whatever Pricing Management currently
 *       has saved. `part` has no fixed base fare (billed by capacity used %, see
 *       POST /api/pricing/estimate) so its `basePrice` is always `null`.
 *     responses:
 *       200:
 *         description: Vehicle types fetched
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
 *                         vehicleTypes:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:        { type: string, enum: [small, medium, large, part] }
 *                               name:      { type: string, example: 'Medium Truck' }
 *                               capacity:  { type: string, example: 'Up to 5 Tons' }
 *                               basePrice: { type: number, example: 800, nullable: true, description: "From live pricing_config.intraCity.<id>.baseFare; null for part (capacity-based billing)" }
 *                               featured:  { type: boolean, example: true, nullable: true }
 *                               savePercent: { type: integer, example: 40, nullable: true }
 */
router.get('/config/vehicle-types', listVehicleTypes);

/**
 * @swagger
 * /api/config/material-types:
 *   get:
 *     tags: [Config]
 *     summary: List cargo material type options
 *     description: Public, no auth required.
 *     responses:
 *       200:
 *         description: Material types fetched
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
 *                         materialTypes:
 *                           type: array
 *                           items: { type: string }
 *                           example: ['Electronics', 'FMCG', 'Construction', 'Furniture', 'Pharma Products', 'Textiles', 'Auto Parts', 'Other']
 */
router.get('/config/material-types', listMaterialTypes);

/**
 * @swagger
 * /api/config/cities:
 *   get:
 *     tags: [Config]
 *     summary: List supported pickup/drop cities
 *     description: Public, no auth required.
 *     responses:
 *       200:
 *         description: Cities fetched
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
 *                         cities:
 *                           type: array
 *                           items: { type: string }
 *                           example: ['Mumbai', 'Pune', 'Delhi', 'Bengaluru']
 */
router.get('/config/cities', listCities);

/**
 * @swagger
 * /api/config/distance:
 *   post:
 *     tags: [Config]
 *     summary: Look up an approximate distance between two cities
 *     description: |
 *       Public, no auth required. Backed by the active LocationProvider (LOCATION_PROVIDER env var);
 *       the default fake provider uses a static city-pair distance table (no Google Maps integration).
 *       Returns 404 for any pair not in the table instead of guessing a distance.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pickup, drop]
 *             properties:
 *               pickup: { type: string, example: 'Mumbai' }
 *               drop:   { type: string, example: 'Pune' }
 *     responses:
 *       200:
 *         description: Distance fetched
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
 *                         distance: { type: number, example: 150, description: 'Distance in km' }
 *       404:
 *         description: Distance unavailable for this city pair
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/config/distance', getDistance);

module.exports = router;
