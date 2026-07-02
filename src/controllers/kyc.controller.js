const KycModel = require('../models/kyc.model');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── POST /api/kyc/submit ──────────────────────────────────────────────────────
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
    return successResponse(res, 200, 'KYC documents submitted for review', { submission, kyc_status: 'pending' });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/kyc/me ────────────────────────────────────────────────────────────
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

// ─── GET /api/admin/kyc ─────────────────────────────────────────────────────────
const getAllKyc = async (req, res, next) => {
  try {
    const { kyc_status, role, search, page = 1, limit = 10 } = req.query;

    const result = await KycModel.findAll({
      kycStatus: kyc_status,
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

// ─── PATCH /api/admin/kyc/:userId/review ────────────────────────────────────────
const reviewKyc = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { status, reason } = req.body;

    const targetUser = await UserModel.findById(userId);
    if (!targetUser) return errorResponse(res, 404, 'User not found');
    if (!['broker', 'driver'].includes(targetUser.role)) {
      return errorResponse(res, 400, 'KYC review only applies to broker/driver accounts');
    }
    if (targetUser.kyc_status !== 'pending') {
      return errorResponse(res, 400, `Cannot review — current KYC status is '${targetUser.kyc_status}', expected 'pending'`);
    }

    const submission = await KycModel.review(userId, { status, reviewerId: req.user.id, reason });

    await AuditLogModel.log({
      userId: req.user.id,
      action: status === 'approved' ? 'KYC_APPROVED' : 'KYC_REJECTED',
      entity: 'kyc_submissions',
      entityId: submission?.id,
      meta: { target_user_id: userId, reason: reason || null },
      ipAddress: req.ip,
    });

    logger.info(`KYC ${status} for ${userId} by admin ${req.user.id}`);
    return successResponse(res, 200, `KYC ${status}`, { submission, kyc_status: status });
  } catch (err) {
    next(err);
  }
};

module.exports = { submitKyc, getMyKyc, getUserKyc, getAllKyc, reviewKyc };
