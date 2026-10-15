const LegalPageModel = require('../models/legalPage.model');
const AccountDeletionRequestModel = require('../models/accountDeletionRequest.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const projectLegalPage = (row) => ({
  id: row.id,
  audience: row.audience,
  pageKey: row.page_key,
  title: row.title,
  content: row.content,
  updatedBy: row.updated_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const projectDeletionRequest = (row) => ({
  id: row.id,
  audience: row.audience,
  name: row.name,
  email: row.email,
  phone: row.phone,
  reason: row.reason,
  status: row.status,
  adminNotes: row.admin_notes,
  processedBy: row.processed_by,
  processedAt: row.processed_at,
  // Set only for a request submitted by a logged-in user (see submitMyAccountDeletionRequest) —
  // null for the public/logged-out legal-page form, same as the request itself always was before.
  // linkedUser reflects the account's CURRENT state (not a snapshot), so the admin screen can see
  // if it's already been blocked/deleted some other way since the request was filed.
  userId: row.user_id,
  linkedUser: row.user_id ? {
    name: row.linked_user_name, email: row.linked_user_email,
    phone: row.linked_user_phone, status: row.linked_user_status, role: row.linked_user_role,
  } : null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

// GET /api/legal-pages/:audience/:pageKey — public, no auth. Always 200s with whatever content
// is on file (seeded to an empty string for every audience x page_key at migration time), never
// 404s for a page an admin just hasn't written yet — the frontend renders empty content as
// "Content coming soon" rather than treating it as an error state.
const getPublicLegalPage = async (req, res, next) => {
  try {
    const { audience, pageKey } = req.params;
    const page = await LegalPageModel.findByAudienceAndKey(audience, pageKey);
    if (!page) return errorResponse(res, 404, 'Page not found');
    return successResponse(res, 200, 'Page fetched', { page: projectLegalPage(page) });
  } catch (err) {
    next(err);
  }
};

// GET /api/legal-pages — admin only, optionally ?audience=client to scope the table.
const listLegalPages = async (req, res, next) => {
  try {
    const { audience } = req.query;
    const pages = await LegalPageModel.findAll({ audience });
    return successResponse(res, 200, 'Pages fetched', { pages: pages.map(projectLegalPage) });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/legal-pages/:id — admin only. title/content are independently optional, but
// writing neither is a no-op not worth a DB round trip or an audit-log entry.
const updateLegalPage = async (req, res, next) => {
  try {
    const { title, content } = req.body;
    if (title == null && content == null) {
      return errorResponse(res, 422, 'Nothing to update — provide title and/or content');
    }

    const existing = await LegalPageModel.findById(req.params.id);
    if (!existing) return errorResponse(res, 404, 'Page not found');

    const updated = await LegalPageModel.update(req.params.id, { title, content, updatedBy: req.user.id });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'LEGAL_PAGE_UPDATED',
      entity: 'legal_pages',
      entityId: req.params.id,
      meta: { audience: existing.audience, pageKey: existing.page_key, fields: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Page updated', { page: projectLegalPage(updated) });
  } catch (err) {
    next(err);
  }
};

// POST /api/legal-pages/:audience/account-deletion-request — public, no auth, rate-limited (see
// legalPage.routes.js). Only ever logs a request — nothing here deletes or touches any account
// data; an admin reviews account-deletion-requests and handles the actual deletion themselves
// through existing user-management tooling.
const submitAccountDeletionRequest = async (req, res, next) => {
  try {
    const { audience } = req.params;
    const { name, email, phone, reason } = req.body;

    const request = await AccountDeletionRequestModel.create({ audience, name, email, phone, reason });
    logger.info(`Account deletion request ${request.id} submitted (audience=${audience}, email=${email || '—'}, phone=${phone || '—'})`);

    return successResponse(res, 201, "Your request has been received — we'll follow up shortly.", {
      requestId: request.id,
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/account-deletion-requests/me — authenticated (any logged-in role). The in-app
// "Request Account Deletion" action (client/driver/broker Settings) — unlike the public form,
// name/email/phone/audience all come straight from the verified account (req.user, already a
// fresh DB row — see auth.middleware.js), not user-typed values, and user_id links the request
// to the real account so an admin can action it directly via deleteAccountFromRequest below
// instead of having to search for a matching user first.
const submitMyAccountDeletionRequest = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const request = await AccountDeletionRequestModel.create({
      audience: req.user.role,
      name: req.user.name,
      email: req.user.email,
      phone: req.user.phone,
      reason,
      userId: req.user.id,
    });
    logger.info(`Account deletion request ${request.id} submitted by user ${req.user.id} (role=${req.user.role})`);

    return successResponse(res, 201, "Your request has been received — we'll follow up shortly.", {
      requestId: request.id,
    });
  } catch (err) {
    next(err);
  }
};

// GET /api/account-deletion-requests — admin only. ?status=pending&audience=client&page=1&limit=20
const listAccountDeletionRequests = async (req, res, next) => {
  try {
    const { status, audience, page = 1, limit = 20 } = req.query;
    const result = await AccountDeletionRequestModel.findAll({
      status, audience, page: parseInt(page, 10), limit: Math.min(parseInt(limit, 10) || 20, 100),
    });
    return successResponse(res, 200, 'Requests fetched', {
      ...result,
      requests: result.requests.map(projectDeletionRequest),
    });
  } catch (err) {
    next(err);
  }
};

// PATCH /api/account-deletion-requests/:id — admin only. Status/notes only (see the model) —
// the actual account deletion is a separate, manual step the admin takes elsewhere.
const updateAccountDeletionRequest = async (req, res, next) => {
  try {
    const { status, admin_notes: adminNotes } = req.body;
    const existing = await AccountDeletionRequestModel.findById(req.params.id);
    if (!existing) return errorResponse(res, 404, 'Request not found');

    const updated = await AccountDeletionRequestModel.updateStatus(req.params.id, {
      status, adminNotes, processedBy: req.user.id,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'ACCOUNT_DELETION_REQUEST_UPDATED',
      entity: 'account_deletion_requests',
      entityId: req.params.id,
      meta: { status, audience: existing.audience },
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Request updated', { request: projectDeletionRequest(updated) });
  } catch (err) {
    next(err);
  }
};

// POST /api/account-deletion-requests/:id/delete-account — admin only. The actual "delete" action
// this screen was missing: soft-deletes the request's LINKED account (same UserModel.delete/
// status='inactive' semantics and same self/admin guards as the existing Users page "Delete User"
// button — see user.controller.js's deleteUser, deliberately mirrored here rather than
// reinvented) and marks the request completed in one call. 422s if the request has no linked
// account at all (an old, anonymous/logged-out submission) — there's no way to resolve which
// real account that means without the admin finding and deleting it manually via Users instead.
const deleteAccountFromRequest = async (req, res, next) => {
  try {
    const request = await AccountDeletionRequestModel.findById(req.params.id);
    if (!request) return errorResponse(res, 404, 'Request not found');
    if (!request.user_id) {
      return errorResponse(res, 422, 'This request has no linked account — find and delete the matching account from Users instead.');
    }
    if (request.user_id === req.user.id) {
      return errorResponse(res, 400, 'You cannot delete your own account');
    }

    const targetUser = await UserModel.findById(request.user_id);
    if (!targetUser) return errorResponse(res, 404, 'The linked account no longer exists');
    if (targetUser.role === 'admin') {
      return errorResponse(res, 403, 'Cannot delete an admin account');
    }

    await UserModel.delete(targetUser.id);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'USER_DELETED',
      entity: 'users',
      entityId: targetUser.id,
      meta: { deleted_user_phone: targetUser.phone, deleted_user_role: targetUser.role, deletion_request_id: request.id },
      ipAddress: req.ip,
    });

    // updateStatus's own RETURNING * has no linked_user_* columns (that join only happens in
    // findById/findAll) — refetch below for a response shaped the same as every other request
    // projection, rather than returning a differently-shaped row just from this one action.
    await AccountDeletionRequestModel.updateStatus(request.id, {
      status: 'completed',
      adminNotes: req.body?.admin_notes,
      processedBy: req.user.id,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'ACCOUNT_DELETION_REQUEST_UPDATED',
      entity: 'account_deletion_requests',
      entityId: request.id,
      meta: { status: 'completed', audience: request.audience, deleted_user_id: targetUser.id },
      ipAddress: req.ip,
    });

    logger.warn(`Admin ${req.user.id} deleted account ${targetUser.id} from deletion request ${request.id}`);
    return successResponse(res, 200, 'Account deleted', { request: projectDeletionRequest(await AccountDeletionRequestModel.findById(request.id)) });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getPublicLegalPage,
  listLegalPages,
  updateLegalPage,
  submitAccountDeletionRequest,
  submitMyAccountDeletionRequest,
  listAccountDeletionRequests,
  updateAccountDeletionRequest,
  deleteAccountFromRequest,
};
