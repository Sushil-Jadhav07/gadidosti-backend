const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');

const {
  getPublicLegalPage,
  listLegalPages,
  updateLegalPage,
  submitAccountDeletionRequest,
  submitMyAccountDeletionRequest,
  listAccountDeletionRequests,
  updateAccountDeletionRequest,
  deleteAccountFromRequest,
} = require('../controllers/legalPage.controller');
const { authenticate, authorize, requireAdminPage } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');
const {
  pageKeyParamValidation,
  updateLegalPageValidation,
  accountDeletionRequestValidation,
  updateAccountDeletionRequestValidation,
  myAccountDeletionRequestValidation,
  deleteAccountFromRequestValidation,
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

// ─── AUTHENTICATED (any logged-in role) ────────────────────────────────────────

// Keyed by user id, not IP+identifier — the requester is already a known, authenticated
// account, so there's no "which identifier" ambiguity the public form's limiter has to guess at.
const myDeletionRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many requests — please try again later or contact support directly.' },
});

/**
 * @swagger
 * /api/account-deletion-requests/me:
 *   post:
 *     tags: [Legal]
 *     summary: Request deletion of my own account (any logged-in role)
 *     description: Logs a request linked to the authenticated account (name/email/phone/audience all come from the verified account, not the request body) for an admin to review. Does not delete anything itself.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               reason: { type: string }
 *     responses:
 *       201:
 *         description: Request received
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       429:
 *         description: Too many requests from this account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post(
  '/account-deletion-requests/me',
  authenticate,
  myDeletionRequestLimiter,
  myAccountDeletionRequestValidation,
  validate,
  submitMyAccountDeletionRequest
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

/**
 * @swagger
 * /api/account-deletion-requests/{id}/delete-account:
 *   post:
 *     tags: [Legal]
 *     summary: Delete the account linked to this request (admin only)
 *     description: Soft-deletes the linked account (same UserModel.delete/status='inactive' semantics as Users' own "Delete User" button) and marks the request completed, in one call. 422s if the request has no linked account (an old, anonymous submission) — find and delete the matching account from Users instead in that case.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               admin_notes: { type: string }
 *     responses:
 *       200:
 *         description: Account deleted
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SuccessResponse' }
 *       400:
 *         description: Cannot delete your own account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       403:
 *         description: Cannot delete an admin account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       404:
 *         description: Request or linked account not found
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 *       422:
 *         description: Request has no linked account
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/ErrorResponse' }
 */
router.post('/account-deletion-requests/:id/delete-account', authenticate, authorize('admin', 'staff'), requireAdminPage('legal_pages'), deleteAccountFromRequestValidation, validate, deleteAccountFromRequest);

module.exports = router;
