const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const {
  getPublicLegalPage,
  listLegalPages,
  updateLegalPage,
  submitAccountDeletionRequest,
  listAccountDeletionRequests,
  updateAccountDeletionRequest,
} = require('../controllers/legalPage.controller');
const { authenticate, authorize, requireAdminPage } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  pageKeyParamValidation,
  updateLegalPageValidation,
  accountDeletionRequestValidation,
  updateAccountDeletionRequestValidation,
} = require('../validations/legalPage.validation');

// Keyed by IP + whichever identifier the requester gave (email/phone) — same reasoning as
// auth.routes.js's accountKeyGenerator: one real person can't be used to drain a shared IP's
// whole budget, and a single IP still can't hammer the same identifier repeatedly.
const deletionRequestKeyGenerator = (req) => {
  const identifier = String(req.body?.email || req.body?.phone || '').trim().toLowerCase();
  return identifier ? `${req.ip}:${identifier}` : req.ip;
};
const deletionRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: deletionRequestKeyGenerator,
  message: { success: false, message: 'Too many requests — please try again later or contact support directly.' },
});

// ─── PUBLIC (no auth) — app-store compliance links ─────────────────────────────

/**
 * @swagger
 * /api/legal-pages/{audience}/{pageKey}:
 *   get:
 *     tags: [Legal]
 *     summary: Fetch one public legal/compliance page (no auth)
 *     description: Always 200s — a page an admin hasn't written yet comes back with empty content rather than 404ing.
 *     parameters:
 *       - in: path
 *         name: audience
 *         required: true
 *         schema: { type: string, enum: [client, driver, broker] }
 *       - in: path
 *         name: pageKey
 *         required: true
 *         schema: { type: string, enum: [privacy_policy, terms_conditions, account_deletion, contact_support, refund_policy, safety_policy] }
 *     responses:
 *       200:
 *         description: Page fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/legal-pages/:audience/:pageKey', pageKeyParamValidation, validate, getPublicLegalPage);

/**
 * @swagger
 * /api/legal-pages/{audience}/account-deletion-request:
 *   post:
 *     tags: [Legal]
 *     summary: Submit an account deletion request (no auth)
 *     description: Logs the request for an admin to review and action manually — never deletes anything automatically. Rate-limited to 3 per hour per identifier.
 *     parameters:
 *       - in: path
 *         name: audience
 *         required: true
 *         schema: { type: string, enum: [client, driver, broker] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               phone: { type: string }
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Request received
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       422:
 *         description: Neither email nor phone was given, or validation failed
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       429:
 *         description: Too many requests from this identifier/IP
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/legal-pages/:audience/account-deletion-request',
  deletionRequestLimiter,
  accountDeletionRequestValidation,
  validate,
  submitAccountDeletionRequest
);

// ─── ADMIN ──────────────────────────────────────────────────────────────────────

/**
 * @swagger
 * /api/legal-pages:
 *   get:
 *     tags: [Legal]
 *     summary: List every legal page, optionally scoped to one audience (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: audience
 *         schema: { type: string, enum: [client, driver, broker] }
 *     responses:
 *       200:
 *         description: Pages fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/legal-pages', authenticate, authorize('admin', 'staff'), requireAdminPage('legal_pages'), listLegalPages);

/**
 * @swagger
 * /api/legal-pages/{id}:
 *   patch:
 *     tags: [Legal]
 *     summary: Edit a legal page's title/content (admin only)
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title: { type: string }
 *               content: { type: string, description: 'HTML, as produced by the admin dashboard''s rich-text editor' }
 *     responses:
 *       200:
 *         description: Page updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Page not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/legal-pages/:id', authenticate, authorize('admin', 'staff'), requireAdminPage('legal_pages'), updateLegalPageValidation, validate, updateLegalPage);

/**
 * @swagger
 * /api/account-deletion-requests:
 *   get:
 *     tags: [Legal]
 *     summary: List account deletion requests (admin only)
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, completed, rejected] }
 *       - in: query
 *         name: audience
 *         schema: { type: string, enum: [client, driver, broker] }
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *     responses:
 *       200:
 *         description: Requests fetched
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 */
router.get('/account-deletion-requests', authenticate, authorize('admin', 'staff'), requireAdminPage('legal_pages'), listAccountDeletionRequests);

/**
 * @swagger
 * /api/account-deletion-requests/{id}:
 *   patch:
 *     tags: [Legal]
 *     summary: Update an account deletion request's status/notes (admin only)
 *     description: Record-keeping only — does not delete or touch any account data. The admin handles the actual deletion separately.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status: { type: string, enum: [pending, completed, rejected] }
 *               admin_notes: { type: string }
 *     responses:
 *       200:
 *         description: Request updated
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       404:
 *         description: Request not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.patch('/account-deletion-requests/:id', authenticate, authorize('admin', 'staff'), requireAdminPage('legal_pages'), updateAccountDeletionRequestValidation, validate, updateAccountDeletionRequest);

module.exports = router;
