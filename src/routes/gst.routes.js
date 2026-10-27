const express = require('express');
const router = express.Router();

const { verifyGst, getGstStatus } = require('../controllers/gst.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { verifyGstValidation } = require('../validations/gst.validation');

/**
 * @swagger
 * /api/gst/verify:
 *   post:
 *     tags: [GST]
 *     summary: Verify a client's GSTIN (client only)
 *     description: Mandatory for every client before they can create a booking — see POST /api/bookings' GST_VERIFICATION_REQUIRED gate. Single-shot and auto-verified, no admin review step.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [gstin]
 *             properties:
 *               gstin: { type: string, example: "27ABCDE1234F1Z5" }
 *     responses:
 *       200:
 *         description: Result of the verification attempt (status 'verified' or 'failed')
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.post('/gst/verify', authenticate, authorize('client'), verifyGstValidation, validate, verifyGst);

/**
 * @swagger
 * /api/gst/status:
 *   get:
 *     tags: [GST]
 *     summary: Get own GST verification status (client only)
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: GST status fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/gst/status', authenticate, authorize('client'), getGstStatus);

module.exports = router;
