const express = require('express');
const router = express.Router();

const { listPincodes, createPincode, setPincodeActive, deletePincode, downloadSampleTemplate, bulkUploadPincodes } = require('../controllers/geofence.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const upload = require('../middleware/upload.middleware');
const { createPincodeValidation, setPincodeActiveValidation } = require('../validations/geofence.validation');

// Deliberately NOT gated by requireAdminPage/ADMIN_PAGE_KEYS — authorize('admin') only, so this
// can never be granted to a 'staff' account. There's no separate "superadmin" role in this
// codebase (plain 'admin' is already unconditionally full-access everywhere else); this is what
// "superadmin-only" means here in practice.

/**
 * @swagger
 * /api/admin/geofencing/pincodes:
 *   get:
 *     tags: [Geofencing]
 *     summary: List every whitelisted pincode (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Pincodes fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/admin/geofencing/pincodes', authenticate, authorize('admin'), listPincodes);

/**
 * @swagger
 * /api/admin/geofencing/pincodes:
 *   post:
 *     tags: [Geofencing]
 *     summary: Add a pincode to the whitelist (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [pincode]
 *             properties:
 *               pincode: { type: string, example: "452001" }
 *               label: { type: string, example: "Indore" }
 *     responses:
 *       201:
 *         description: Pincode added
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       409:
 *         description: Pincode already on the whitelist
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/admin/geofencing/pincodes', authenticate, authorize('admin'), createPincodeValidation, validate, createPincode);

/**
 * @swagger
 * /api/admin/geofencing/pincodes/sample:
 *   get:
 *     tags: [Geofencing]
 *     summary: Download a sample .xlsx template for bulk pincode upload (admin only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Sample .xlsx file
 */
// Registered BEFORE /pincodes/:id below — otherwise "sample"/"bulk" would be swallowed as an :id.
router.get('/admin/geofencing/pincodes/sample', authenticate, authorize('admin'), downloadSampleTemplate);

/**
 * @swagger
 * /api/admin/geofencing/pincodes/bulk:
 *   post:
 *     tags: [Geofencing]
 *     summary: Bulk-upload pincodes from an .xlsx or .csv file (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       200:
 *         description: Bulk upload processed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: No file / no rows / too many rows
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/admin/geofencing/pincodes/bulk', authenticate, authorize('admin'), upload.single('file'), bulkUploadPincodes);

/**
 * @swagger
 * /api/admin/geofencing/pincodes/{id}:
 *   patch:
 *     tags: [Geofencing]
 *     summary: Activate/deactivate a whitelisted pincode (admin only)
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
 *             required: [active]
 *             properties:
 *               active: { type: boolean }
 *     responses:
 *       200:
 *         description: Pincode updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Pincode not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/admin/geofencing/pincodes/:id', authenticate, authorize('admin'), setPincodeActiveValidation, validate, setPincodeActive);

/**
 * @swagger
 * /api/admin/geofencing/pincodes/{id}:
 *   delete:
 *     tags: [Geofencing]
 *     summary: Remove a pincode from the whitelist (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Pincode removed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Pincode not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.delete('/admin/geofencing/pincodes/:id', authenticate, authorize('admin'), deletePincode);

module.exports = router;
