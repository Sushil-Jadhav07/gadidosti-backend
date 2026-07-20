const DisputeModel = require('../models/dispute.model');
const BookingModel = require('../models/booking.model');
const AuditLogModel = require('../models/auditLog.model');
const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const projectDispute = (row, role) => {
  const base = {
    id: row.id,
    disputeNumber: row.dispute_number,
    bookingId: row.booking_id,
    bookingNumber: row.booking_number,
    raisedBy: row.raised_by_role,
    raisedByName: row.raised_by_name,
    raisedByPhone: row.raised_by_phone,
    issueType: row.issue_type,
    description: row.description,
    status: row.status,
    resolution: row.resolution,
    date: row.created_at,
    updatedAt: row.updated_at,
  };

  // Contact numbers for every party on the booking — admin-only, so support can call whoever's
  // relevant mid-dispute without needing to look up the booking separately.
  if (role === 'admin') {
    base.clientName = row.client_name;
    base.clientPhone = row.client_phone;
    base.brokerName = row.broker_name;
    base.brokerPhone = row.broker_phone;
    base.driverName = row.driver_name;
    base.driverPhone = row.driver_phone;
  }

  return base;
};

// ─── POST /api/disputes ───────────────────────────────────────────────────────
const createDispute = async (req, res, next) => {
  try {
    const { booking_id, issue_type, description } = req.body;

    const booking = await BookingModel.findById(booking_id);
    if (!booking) return errorResponse(res, 404, 'Booking not found');

    const raisedByRole = req.user.role === 'broker' ? 'broker' : 'client';
    if (raisedByRole === 'client' && booking.client_id !== req.user.id) {
      return errorResponse(res, 403, 'You can only raise a dispute on your own booking');
    }
    if (raisedByRole === 'broker' && booking.broker_id !== req.user.id) {
      return errorResponse(res, 403, 'You can only raise a dispute on your own booking');
    }

    const dispute = await DisputeModel.create({
      bookingId: booking_id,
      raisedByUserId: req.user.id,
      raisedByRole,
      issueType: issue_type,
      description,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DISPUTE_RAISED',
      entity: 'disputes',
      entityId: dispute.id,
      meta: { booking_id, issue_type },
      ipAddress: req.ip,
    });

    logger.info(`Dispute raised: ${dispute.id} on booking ${booking_id} by ${req.user.id}`);
    const full = await DisputeModel.findById(dispute.id);
    return successResponse(res, 201, 'Dispute raised', { dispute: projectDispute(full, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/disputes ────────────────────────────────────────────────────────
const listDisputes = async (req, res, next) => {
  try {
    const { status, issue_type, page = 1, limit = 10 } = req.query;

    const result = await DisputeModel.findAll({
      scopeUserId: req.user.role === 'admin' ? undefined : req.user.id,
      status,
      issueType: issue_type,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Disputes fetched', { ...result, disputes: result.disputes.map((d) => projectDispute(d, req.user.role)) });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/disputes/:id ────────────────────────────────────────────────────
const getDispute = async (req, res, next) => {
  try {
    const dispute = await DisputeModel.findById(req.params.id);
    if (!dispute) return errorResponse(res, 404, 'Dispute not found');
    if (req.user.role !== 'admin' && dispute.raised_by_user_id !== req.user.id) {
      return errorResponse(res, 403, 'You do not have access to this dispute');
    }

    return successResponse(res, 200, 'Dispute fetched', { dispute: projectDispute(dispute, req.user.role) });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/disputes/:id/resolve ──────────────────────────────────────────
const resolveDispute = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { resolution } = req.body;

    const dispute = await DisputeModel.findById(id);
    if (!dispute) return errorResponse(res, 404, 'Dispute not found');
    if (dispute.status === 'resolved') return errorResponse(res, 400, 'Dispute is already resolved');

    const updated = await DisputeModel.resolve(id, resolution);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'DISPUTE_RESOLVED',
      entity: 'disputes',
      entityId: id,
      meta: { resolution },
      ipAddress: req.ip,
    });

    await NotificationModel.create({
      userId: dispute.raised_by_user_id,
      title: 'Dispute Resolved',
      message: `Your dispute has been resolved: ${resolution}`,
      type: 'dispute',
      meta: { dispute_id: id },
    });

    logger.info(`Dispute ${id} resolved by admin ${req.user.id}`);
    const full = await DisputeModel.findById(id);
    return successResponse(res, 200, 'Dispute resolved', { dispute: projectDispute(full || updated, req.user.role) });
  } catch (err) {
    next(err);
  }
};

module.exports = { createDispute, listDisputes, getDispute, resolveDispute };
