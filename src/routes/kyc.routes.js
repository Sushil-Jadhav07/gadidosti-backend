const express = require('express');
const router = express.Router();

const {
  submitKyc,
  uploadKycDocument,
  listMyKycDocuments,
  listUserKycDocuments,
  getKycFile,
  getKycById,
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
 *
 *       **Optional photo keys** (get the url from `POST /api/kyc/documents/upload` first,
 *       then include it here): `pan_photo_url`, `aadhaar_photo_url`
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
 *               pan_photo_url: "https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>"
 *               aadhaar_number: "XXXX-XXXX-1234"
 *               aadhaar_photo_url: "https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>"
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
 *
 *       **Optional photo keys** (get the url from `POST /api/kyc/documents/upload` first,
 *       then include it here): `license_photo_url`, `aadhaar_photo_url`
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
 *               license_photo_url: "https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>"
 *               aadhaar_number: "XXXX-XXXX-1234"
 *               aadhaar_photo_url: "https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>"
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
 *       Uploads a document photo/PDF via the active StorageProvider (STORAGE_PROVIDER env var).
 *       `postgres` stores the bytes in the kyc_files table (persists across deploys/restarts —
 *       use this in production); `fake` (default) writes to local disk instead, which is lost on
 *       every deploy/restart on platforms with an ephemeral filesystem (e.g. Render) — dev only.
 *
 *       Re-uploading the same `document_key` replaces the previous file for that key (old row is
 *       deleted when STORAGE_PROVIDER=postgres) — this is how document photos get "edited".
 *
 *       The returned `url` isn't saved anywhere by this call alone — pass it back in the
 *       `documents` object on `POST /api/kyc/broker` or `POST /api/kyc/driver` under a
 *       `*_photo_url` key (e.g. `pan_photo_url`, `license_photo_url`) to attach it to the submission.
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
 *               document_key: { type: string, example: 'pan_photo', description: "Free-form label for this file, e.g. 'pan_photo', 'aadhaar_photo', 'license_photo'" }
 *     responses:
 *       200:
 *         description: Document uploaded
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
 *                         document:
 *                           type: object
 *                           properties:
 *                             id:            { type: string, format: uuid, nullable: true }
 *                             user_id:       { type: string, format: uuid }
 *                             document_type: { type: string, example: 'pan_photo' }
 *                             url:           { type: string, example: 'https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>' }
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
 * /api/kyc/documents:
 *   get:
 *     tags: [KYC]
 *     summary: List own uploaded KYC documents, one entry per document type (broker/driver only)
 *     description: |
 *       Unlike GET /api/kyc/status (which returns documents merged into one object keyed by
 *       document_type), this returns each uploaded document as a separate object with its own
 *       absolute url, filename, mime type, size, and upload timestamp.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Documents fetched
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
 *                         documents:
 *                           type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               id:            { type: string, format: uuid }
 *                               document_type: { type: string, example: 'pan_photo' }
 *                               path:          { type: string, example: 'kyc/<user_id>/pan_photo/pan.pdf' }
 *                               filename:      { type: string }
 *                               mime_type:     { type: string }
 *                               size_bytes:    { type: integer }
 *                               uploaded_at:   { type: string, format: date-time }
 *                               url:           { type: string, example: 'https://gadidosti-backend.onrender.com/api/kyc/documents/file/<id>' }
 */
router.get('/kyc/documents', authenticate, authorize('broker', 'driver'), listMyKycDocuments);

/**
 * @swagger
 * /api/kyc/documents/file/{id}:
 *   get:
 *     tags: [KYC]
 *     summary: Fetch a stored KYC document file (owner or admin only)
 *     description: |
 *       Serves the raw file bytes for a document uploaded while STORAGE_PROVIDER=postgres.
 *       Only the uploading user or an admin may fetch it.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: File bytes
 *         content:
 *           application/octet-stream: {}
 *       403:
 *         description: Not your document
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: File not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/kyc/documents/file/:id', authenticate, authorize('broker', 'driver', 'admin'), getKycFile);

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

/**
 * @swagger
 * /api/kyc/{userId}:
 *   get:
 *     tags: [KYC]
 *     summary: Get own KYC status + submission by explicit user id (broker/driver only)
 *     description: |
 *       Self-only counterpart to GET /api/admin/kyc/{userId} — same data as GET /api/kyc/status,
 *       but addressed by id instead of implicitly via the bearer token. Passing any id other
 *       than your own returns 404 (not 403), so it doesn't reveal whether that id exists.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
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
 *       404:
 *         description: Not your id
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/kyc/:userId', authenticate, authorize('broker', 'driver'), getKycById);

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
 * /api/admin/kyc/{userId}/documents:
 *   get:
 *     tags: [KYC]
 *     summary: List a user's uploaded KYC documents, one entry per document type (admin only)
 *     description: Same shape as GET /api/kyc/documents but for any broker/driver, for the admin review screen.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Documents fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.get('/admin/kyc/:userId/documents', authenticate, authorize('admin'), listUserKycDocuments);

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
