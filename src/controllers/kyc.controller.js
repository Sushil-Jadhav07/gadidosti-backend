const KycModel = require('../models/kyc.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getStorageProvider } = require('../providers/storage');

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

    logger.info(`KYC document uploaded: ${req.user.id} [${document_key}]`);
    return successResponse(res, 200, 'Document uploaded', { url, submission });
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

module.exports = { submitKyc, uploadKycDocument, getMyKyc, getUserKyc, getAllKyc, verifyKyc, rejectKyc };
