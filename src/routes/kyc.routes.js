const express = require('express');
const router = express.Router();

const { submitKyc, getMyKyc, getUserKyc, getAllKyc, reviewKyc } = require('../controllers/kyc.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const { submitKycValidation, reviewKycValidation } = require('../validations/kyc.validation');

// ─── Broker/Driver — own KYC ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/kyc/submit:
 *   post:
 *     tags: [KYC]
 *     summary: Submit KYC documents (broker/driver)
 *     description: |
 *       Submits document numbers for admin review. Sets `kyc_status` to `pending`.
 *       Resubmitting (e.g. after a rejection) overwrites the previous submission and clears any rejection reason.
 *
 *       **Suggested document keys:**
 *       - Driver: `license_number`, `aadhaar_number`, `pan_number`, `vehicle_registration_number`, `vehicle_insurance_number`
 *       - Broker: `pan_number`, `aadhaar_number`, `gst_number`, `bank_account_number`, `business_registration_number`
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [documents]
 *             properties:
 *               documents:
 *                 type: object
 *                 additionalProperties: { type: string }
 *           example:
 *             documents:
 *               license_number: "MH-2020123456789"
 *               aadhaar_number: "XXXX-XXXX-1234"
 *               vehicle_registration_number: "MH-12-CD-5678"
 *     responses:
 *       200:
 *         description: KYC submitted for review
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Client/admin accounts cannot submit KYC
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/kyc/submit', authenticate, authorize('broker', 'driver'), submitKycValidation, validate, submitKyc);

/**
 * @swagger
 * /api/kyc/me:
 *   get:
 *     tags: [KYC]
 *     summary: Get own KYC status + submission
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: KYC status fetched
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
 *                         kyc_status: { type: string, enum: [not_submitted, pending, approved, rejected] }
 *                         submission:
 *                           $ref: '#/components/schemas/KycSubmission'
 */
router.get('/kyc/me', authenticate, authorize('broker', 'driver'), getMyKyc);

// ─── Admin — KYC review queue ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/kyc:
 *   get:
 *     tags: [KYC]
 *     summary: List KYC submissions (admin only)
 *     description: Returns broker/driver users with their KYC status and submitted documents, filterable and paginated. Pending submissions are sorted first.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: kyc_status
 *         schema: { type: string, enum: [not_submitted, pending, approved, rejected] }
 *       - in: query
 *         name: role
 *         schema: { type: string, enum: [broker, driver] }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 100 }
 *     responses:
 *       200:
 *         description: KYC submissions fetched
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Admin access required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/admin/kyc', authenticate, authorize('admin'), getAllKyc);

/**
 * @swagger
 * /api/admin/kyc/{userId}:
 *   get:
 *     tags: [KYC]
 *     summary: Get a single user's KYC submission (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: KYC submission fetched
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get('/admin/kyc/:userId', authenticate, authorize('admin'), getUserKyc);

/**
 * @swagger
 * /api/admin/kyc/{userId}/review:
 *   patch:
 *     tags: [KYC]
 *     summary: Approve or reject a user's KYC (admin only)
 *     description: Only allowed while the user's `kyc_status` is `pending`. Approving sets `kyc_status` to `approved`; rejecting requires a reason and sets it to `rejected` (the user may resubmit).
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [approved, rejected] }
 *               reason: { type: string, description: "Required when status is 'rejected'", example: "Aadhaar number does not match uploaded name" }
 *     responses:
 *       200:
 *         description: KYC reviewed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Not currently pending, or invalid role
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/admin/kyc/:userId/review', authenticate, authorize('admin'), reviewKycValidation, validate, reviewKyc);

module.exports = router;
