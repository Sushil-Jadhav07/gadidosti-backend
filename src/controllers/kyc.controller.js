const pool = require('../config/db');
const KycModel = require('../models/kyc.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getStorageProvider } = require('../providers/storage');
const { getFileUrl, toAbsoluteUrl } = require('../utils/fileUrl');

const storageProvider = getStorageProvider();

// ─── POST /api/kyc/broker, POST /api/kyc/driver ─────────────────────────────────
// Shared handler — role-specific required fields are enforced by validation
// middleware on each route (kyc.validation.js), not here.
const submitKyc = async (req, res, next) => {
  try {
    const { documents } = req.body;

    const submission = await KycModel.upsertSubmission(req.user.id, documents);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_SUBMITTED',
      entity: 'kyc_submissions',
      entityId: submission.id,
      meta: { document_keys: Object.keys(documents) },
      ipAddress: req.ip,
    });

    logger.info(`KYC submitted: ${req.user.id} [${req.user.role}]`);
    return successResponse(res, 200, 'KYC documents submitted for review', { submission, kyc_status: 'submitted' });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/kyc/documents/upload ──────────────────────────────────────────────
// Uploads a document file via the active StorageProvider and merges the returned
// URL into the user's kyc_submissions.documents under `document_key`. Requires a
// multipart request — see upload.middleware.js (multer, memory storage) on the route.
const uploadKycDocument = async (req, res, next) => {
  try {
    if (!req.file) return errorResponse(res, 422, 'No file uploaded — attach it as multipart form field "file"');

    const { document_key } = req.body;
    if (!document_key) return errorResponse(res, 422, 'document_key is required (e.g. "pan_card_photo")');

    const { url } = await storageProvider.upload({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      documentKey: document_key,
      folder: `kyc/${req.user.id}`,
    });

    const existing = await KycModel.findByUserId(req.user.id);
    const documents = { ...(existing?.documents || {}), [document_key]: url };
    const submission = await KycModel.upsertSubmission(req.user.id, documents);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_DOCUMENT_UPLOADED',
      entity: 'kyc_submissions',
      entityId: submission.id,
      meta: { document_key },
      ipAddress: req.ip,
    });

    // Postgres-backed uploads return /api/kyc/documents/file/<id> — pull the id back out
    // for the response. Other providers (e.g. local disk) already return a servable path.
    const fileId = url.startsWith('/api/kyc/documents/file/') ? url.split('/').pop() : null;

    // Re-uploading the same document_key replaces it — drop the old kyc_files row so
    // it doesn't sit around as an orphan.
    if (fileId) await KycModel.deleteOtherFiles(req.user.id, document_key, fileId);

    logger.info(`KYC document uploaded: ${req.user.id} [${document_key}]`);
    return successResponse(res, 200, 'Document uploaded', {
      document: {
        id: fileId,
        user_id: req.user.id,
        document_type: document_key,
        url: toAbsoluteUrl(req, url),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/documents ───────────────────────────────────────────────────────
// Lists the caller's own uploaded documents, one object per document_type (not merged
// into a single blob like kyc_submissions.documents), each with a ready-to-use absolute url.
const listMyKycDocuments = async (req, res, next) => {
  try {
    const files = await KycModel.listFiles(req.user.id);
    const documents = files.map((f) => ({
      id: f.id,
      document_type: f.document_type,
      path: `kyc/${f.user_id}/${f.document_type}/${f.filename}`,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: Number(f.size_bytes),
      uploaded_at: f.created_at,
      url: getFileUrl(req, f.id),
    }));
    return successResponse(res, 200, 'KYC documents fetched', { documents });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/kyc/:userId/documents ────────────────────────────────────────
const listUserKycDocuments = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) return errorResponse(res, 404, 'User not found');

    const files = await KycModel.listFiles(userId);
    const documents = files.map((f) => ({
      id: f.id,
      document_type: f.document_type,
      path: `kyc/${f.user_id}/${f.document_type}/${f.filename}`,
      filename: f.filename,
      mime_type: f.mime_type,
      size_bytes: Number(f.size_bytes),
      uploaded_at: f.created_at,
      url: getFileUrl(req, f.id),
    }));
    return successResponse(res, 200, 'KYC documents fetched', { documents });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/documents/file/:id ─────────────────────────────────────────────
// Serves a file uploaded when STORAGE_PROVIDER=postgres (kyc_files.data). Only the
// owning user or an admin may fetch it — these are PAN/Aadhaar/license photos.
const getKycFile = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await pool.query(
      `SELECT user_id, filename, mime_type, data FROM kyc_files WHERE id = $1`,
      [id]
    );
    const file = rows[0];
    if (!file) return errorResponse(res, 404, 'File not found');

    if (req.user.role !== 'admin' && req.user.id !== file.user_id) {
      return errorResponse(res, 403, 'Not your document');
    }

    res.set('Content-Type', file.mime_type);
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    return res.send(file.data);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/status ──────────────────────────────────────────────────────────
const getMyKyc = async (req, res, next) => {
  try {
    const submission = await KycModel.findByUserId(req.user.id);
    return successResponse(res, 200, 'KYC status fetched', {
      kyc_status: req.user.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/:userId ─────────────────────────────────────────────────────────
// Self-only counterpart to GET /api/admin/kyc/:userId — a broker/driver may only fetch
// their own KYC this way (404 for anyone else's id, so it doesn't leak who has an account).
const getKycById = async (req, res, next) => {
  try {
    const { userId } = req.params;
    if (userId !== req.user.id) return errorResponse(res, 404, 'User not found');

    const submission = await KycModel.findByUserId(userId);
    return successResponse(res, 200, 'KYC status fetched', {
      kyc_status: req.user.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/kyc/:userId ─────────────────────────────────────────────────
const getUserKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) return errorResponse(res, 404, 'User not found');

    const submission = await KycModel.findByUserId(userId);
    return successResponse(res, 200, 'KYC submission fetched', {
      kyc_status: targetUser.kyc_status,
      submission,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/kyc/pending ──────────────────────────────────────────────────
const getAllKyc = async (req, res, next) => {
  try {
    const { kyc_status, role, search, page = 1, limit = 10 } = req.query;

    const result = await KycModel.findAll({
      kycStatus: kyc_status, // model defaults to 'submitted' (the review queue) when omitted
      role,
      search,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'KYC submissions fetched', result);
  } catch (err) {
    next(err);
  }
};

const assertReviewable = async (userId) => {
  const targetUser = await UserModel.findById(userId);
  if (!targetUser) return { error: [404, 'User not found'] };
  if (!['broker', 'driver'].includes(targetUser.role)) {
    return { error: [400, 'KYC review only applies to broker/driver accounts'] };
  }
  if (targetUser.kyc_status === 'verified') {
    return { error: [400, 'KYC is already verified'] };
  }
  return { targetUser };
};

// ─── PATCH /api/admin/kyc/:userId/verify ────────────────────────────────────────
const verifyKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;

    const { error } = await assertReviewable(userId);
    if (error) return errorResponse(res, ...error);

    const submission = await KycModel.review(userId, { status: 'verified', reviewerId: req.user.id });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_VERIFIED',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: userId },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId,
      title: 'KYC Verified',
      message: 'Your KYC documents have been verified. You now have full access to the platform.',
      type: 'kyc',
    });

    logger.info(`KYC verified for ${userId} by admin ${req.user.id}`);
    return successResponse(res, 200, 'KYC verified', { submission, kyc_status: 'verified' });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/admin/kyc/:userId/reject ────────────────────────────────────────
const rejectKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    const { error } = await assertReviewable(userId);
    if (error) return errorResponse(res, ...error);

    const submission = await KycModel.review(userId, { status: 'rejected', reviewerId: req.user.id, reason });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'KYC_REJECTED',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: userId, reason },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId,
      title: 'KYC Rejected',
      message: `Your KYC submission was rejected: ${reason}. Please review and resubmit your documents.`,
      type: 'kyc',
      meta: { reason },
    });

    logger.info(`KYC rejected for ${userId} by admin ${req.user.id}`);
    return successResponse(res, 200, 'KYC rejected', { submission, kyc_status: 'rejected' });
  } catch (err) {
    next(err);
  }
};

module.exports = {
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
};
