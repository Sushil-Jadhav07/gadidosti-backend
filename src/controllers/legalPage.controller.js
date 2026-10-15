const LegalPageModel = require('../models/legalPage.model');
const AccountDeletionRequestModel = require('../models/accountDeletionRequest.model');
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

module.exports = {
  getPublicLegalPage,
  listLegalPages,
  updateLegalPage,
  submitAccountDeletionRequest,
  listAccountDeletionRequests,
  updateAccountDeletionRequest,
};
