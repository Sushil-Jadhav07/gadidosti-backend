const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const { getVerificationProvider } = require('../providers/verification');

const verificationProvider = getVerificationProvider();

// Same masking reasoning as kyc.controller.js's verificationErrorMessage — an infra/credential
// failure from the provider can carry details not meant for an end-user's screen.
const VERIFICATION_UNAVAILABLE_MESSAGE = 'Verification service is temporarily unavailable — please try again in a few minutes.';
const isInfraFailure = (message) => typeof message === 'string' && message.startsWith('Cashfree verification unavailable:');
const verificationErrorMessage = (err) => (isInfraFailure(err.message) ? VERIFICATION_UNAVAILABLE_MESSAGE : (err.message || VERIFICATION_UNAVAILABLE_MESSAGE));

// ─── POST /api/gst/verify ────────────────────────────────────────────────────────
// Mandatory for every client, no exceptions — see booking.controller.js::createBooking's gate.
// Single-shot, auto-verified (no admin review step, unlike driver/broker KYC): the provider
// result alone decides 'verified' or 'failed'.
const verifyGst = async (req, res, next) => {
  try {
    const { gstin } = req.body;
    if (!gstin) return errorResponse(res, 422, 'gstin is required');

    const result = await verificationProvider.verifyGst({ gstin });
    const status = result.status === 'verified' ? 'verified' : 'failed';
    await UserModel.setGstVerification(req.user.id, { gstNumber: gstin, status, result });

    await AuditLogModel.log({
      userId: req.user.id, action: 'CLIENT_GST_VERIFICATION_ATTEMPTED', entity: 'users',
      entityId: req.user.id, meta: { status }, ipAddress: req.ip,
    });

    logger.info(`Client GST verification for ${req.user.id}: ${status}`);
    return successResponse(res, 200, status === 'verified' ? 'GST verified' : 'GST verification did not pass', {
      gst_verification_status: status,
      details: result.details,
    });
  } catch (err) {
    logger.error(`Client GST verification failed for ${req.user.id}: ${err.message}`, err);
    return errorResponse(res, 503, verificationErrorMessage(err));
  }
};

// ─── GET /api/gst/status ─────────────────────────────────────────────────────────
const getGstStatus = async (req, res, next) => {
  try {
    return successResponse(res, 200, 'GST status fetched', {
      gst_number: req.user.gst_number || null,
      gst_verification_status: req.user.gst_verification_status,
      gst_verified_at: req.user.gst_verified_at,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { verifyGst, getGstStatus };
