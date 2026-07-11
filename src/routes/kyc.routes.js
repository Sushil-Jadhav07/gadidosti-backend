const express = require('express');
const router = express.Router();

const {
  submitKyc,
  uploadKycDocument,
  getMyKyc,
  getUserKyc,
  getAllKyc,
  verifyKyc,
  rejectKyc,
} = require('../controllers/kyc.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const upload = require('../middleware/upload.middleware');
const {
  submitBrokerKycValidation,
  submitDriverKycValidation,
  rejectKycValidation,
} = require('../validations/kyc.validation');

// ─── Broker/Driver — submit KYC ──────────────────────────────────────────────

/**
 * @swagger
 * /api/kyc/broker:
 *   post:
 *     tags: [KYC]
 *     summary: Submit broker KYC (broker only)
 *     description: |
 *       Submits the broker's legal + financial identity documents for review. Sets `kyc_status` to `submitted`.
 *       Resubmitting (e.g. after a rejection) overwrites the previous submission and clears any rejection reason.
 *
 *       **Required document keys:** `pan_number`, `aadhaar_number`, `gst_number`, `bank_account_number`, `business_registration_number`
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
 *               pan_number: "ABCDE1234F"
 *               aadhaar_number: "XXXX-XXXX-1234"
 *               gst_number: "27ABCDE1234F1Z5"
 *               bank_account_number: "1234567890123"
 *               business_registration_number: "U12345MH2020PTC123456"
 *     responses:
 *       200:
 *         description: KYC submitted for review
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Only broker accounts may use this endpoint
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors — missing required documents
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/kyc/broker', authenticate, authorize('broker'), submitBrokerKycValidation, validate, submitKyc);

/**
 * @swagger
 * /api/kyc/driver:
 *   post:
 *     tags: [KYC]
 *     summary: Submit driver KYC (driver only)
 *     description: |
 *       Submits the driver's license + vehicle documents for review. Sets `kyc_status` to `submitted`.
 *       Resubmitting (e.g. after a rejection) overwrites the previous submission and clears any rejection reason.
 *
 *       **Required document keys:** `license_number`, `aadhaar_number`, `vehicle_registration_number`, `vehicle_insurance_number`
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
 *               vehicle_insurance_number: "INS-2024-567890"
 *     responses:
 *       200:
 *         description: KYC submitted for review
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       403:
 *         description: Only driver accounts may use this endpoint
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         description: Validation errors — missing required documents
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/kyc/driver', authenticate, authorize('driver'), submitDriverKycValidation, validate, submitKyc);

/**
 * @swagger
 * /api/kyc/documents/upload:
 *   post:
 *     tags: [KYC]
 *     summary: Upload a KYC document file
 *     description: |
 *       Uploads a document photo/PDF via the active StorageProvider (STORAGE_PROVIDER env var, defaults to a local-disk
 *       fake provider not safe for production) and merges the returned URL into the caller's kyc_submissions.documents
 *       under `document_key`.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file, document_key]
 *             properties:
 *               file: { type: string, format: binary }
 *               document_key: { type: string, example: 'pan_card_photo' }
 *     responses:
 *       200:
 *         description: Document uploaded
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       422:
 *         description: Missing file or document_key
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.post('/kyc/documents/upload', authenticate, authorize('broker', 'driver'), upload.single('file'), uploadKycDocument);

/**
 * @swagger
 * /api/kyc/status:
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
 *                         kyc_status: { type: string, enum: [pending, submitted, verified, rejected] }
 *                         submission:
 *                           $ref: '#/components/schemas/KycSubmission'
 */
router.get('/kyc/status', authenticate, authorize('broker', 'driver'), getMyKyc);

// ─── Admin — KYC review queue ──────────────────────────────────────────────────

/**
 * @swagger
 * /api/admin/kyc/pending:
 *   get:
 *     tags: [KYC]
 *     summary: List KYC submissions (admin only)
 *     description: |
 *       With no `kyc_status` filter, returns everyone who has ever submitted (`submitted`, `verified`, or `rejected`) —
 *       i.e. excludes accounts that haven't submitted yet, since there's nothing to review for those.
 *       Pass `kyc_status` explicitly to narrow to just one state, e.g. `submitted` for the review queue.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: kyc_status
 *         schema: { type: string, enum: [pending, submitted, verified, rejected] }
 *         description: Omit to get all submitted/verified/rejected users; pass to narrow to one state
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
router.get('/admin/kyc/pending', authenticate, authorize('admin'), getAllKyc);

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
 * /api/admin/kyc/{userId}/verify:
 *   patch:
 *     tags: [KYC]
 *     summary: Approve a user's KYC (admin only)
 *     description: Only allowed while `kyc_status` is `submitted`. Sets it to `verified` — the switch that unlocks earning (accepting trips/jobs) — and notifies the user.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: KYC verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Not currently submitted, or invalid role
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
router.patch('/admin/kyc/:userId/verify', authenticate, authorize('admin'), verifyKyc);

/**
 * @swagger
 * /api/admin/kyc/{userId}/reject:
 *   patch:
 *     tags: [KYC]
 *     summary: Reject a user's KYC (admin only)
 *     description: Only allowed while `kyc_status` is `submitted`. Requires a reason, sets `kyc_status` to `rejected`, and notifies the user so they can resubmit.
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
 *             required: [reason]
 *             properties:
 *               reason: { type: string, example: "Aadhaar number does not match uploaded name" }
 *     responses:
 *       200:
 *         description: KYC rejected
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *       400:
 *         description: Not currently submitted, or invalid role
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
 *       422:
 *         description: Validation errors — reason is required
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.patch('/admin/kyc/:userId/reject', authenticate, authorize('admin'), rejectKycValidation, validate, rejectKyc);

module.exports = router;
