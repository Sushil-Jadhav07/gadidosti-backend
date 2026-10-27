const GeofenceModel = require('../models/geofence.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── GET /api/admin/geofencing/pincodes ──────────────────────────────────────────
const listPincodes = async (req, res, next) => {
  try {
    const pincodes = await GeofenceModel.list();
    return successResponse(res, 200, 'Pincodes fetched', { pincodes });
  } catch (err) {
    next(err);
  }
};

// ─── POST /api/admin/geofencing/pincodes ─────────────────────────────────────────
const createPincode = async (req, res, next) => {
  try {
    const { pincode, label } = req.body;
    const created = await GeofenceModel.create({ pincode, label });

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODE_ADDED', entity: 'allowed_pincodes',
      entityId: created.id, meta: { pincode }, ipAddress: req.ip,
    });

    logger.info(`Pincode ${pincode} added to geofence whitelist by ${req.user.id}`);
    return successResponse(res, 201, 'Pincode added', { pincode: created });
  } catch (err) {
    if (err.code === '23505') return errorResponse(res, 409, 'This pincode is already on the whitelist');
    next(err);
  }
};

// ─── PATCH /api/admin/geofencing/pincodes/:id ────────────────────────────────────
const setPincodeActive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { active } = req.body;

    const updated = await GeofenceModel.setActive(id, active);
    if (!updated) return errorResponse(res, 404, 'Pincode not found');

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODE_TOGGLED', entity: 'allowed_pincodes',
      entityId: id, meta: { active }, ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Pincode updated', { pincode: updated });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/admin/geofencing/pincodes/:id ───────────────────────────────────
const deletePincode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const removed = await GeofenceModel.remove(id);
    if (!removed) return errorResponse(res, 404, 'Pincode not found');

    await AuditLogModel.log({
      userId: req.user.id, action: 'GEOFENCE_PINCODE_REMOVED', entity: 'allowed_pincodes',
      entityId: id, ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Pincode removed', {});
  } catch (err) {
    next(err);
  }
};

module.exports = { listPincodes, createPincode, setPincodeActive, deletePincode };
