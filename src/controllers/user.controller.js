const bcrypt = require('bcryptjs');
const UserModel = require('../models/user.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

// ─── GET /api/users/profile ───────────────────────────────────────────────────
const getProfile = async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user.id);
    if (!user) return errorResponse(res, 404, 'User not found');
    return successResponse(res, 200, 'Profile fetched', { user });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/users/profile ─────────────────────────────────────────────────
const updateProfile = async (req, res, next) => {
  try {
    const { name, email, profile_image, address, company_name } = req.body;

    if (email) {
      const existing = await UserModel.findByEmail(email);
      if (existing && existing.id !== req.user.id) {
        return errorResponse(res, 409, 'Email already in use by another account');
      }
    }

    const updated = await UserModel.updateProfile(req.user.id, {
      name,
      email,
      profileImage: profile_image,
      address,
      companyName: company_name,
    });

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'PROFILE_UPDATED',
      entity: 'users',
      entityId: req.user.id,
      meta: { fields: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Profile updated successfully', { user: updated });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/users/change-password ─────────────────────────────────────────
const changePassword = async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;

    const user = await UserModel.findByPhone(req.user.phone);
    if (!user) return errorResponse(res, 404, 'User not found');

    const isValid = await bcrypt.compare(current_password, user.password_hash);
    if (!isValid) return errorResponse(res, 400, 'Current password is incorrect');

    if (current_password === new_password) {
      return errorResponse(res, 400, 'New password must be different from current password');
    }

    const newHash = await bcrypt.hash(new_password, 12);
    await UserModel.updatePassword(req.user.id, newHash);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'PASSWORD_CHANGED',
      entity: 'users',
      entityId: req.user.id,
      ipAddress: req.ip,
    });

    logger.info(`Password changed: ${req.user.phone}`);
    return successResponse(res, 200, 'Password changed successfully');
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/users ─────────────────────────────────────────────────────
const getAllUsers = async (req, res, next) => {
  try {
    const { role, status, kyc_status, search, page = 1, limit = 10 } = req.query;

    const result = await UserModel.findAll({
      role,
      status,
      kycStatus: kyc_status,
      search,
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Users fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/users/:id ─────────────────────────────────────────────────
const getUserById = async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.params.id);
    if (!user) return errorResponse(res, 404, 'User not found');
    return successResponse(res, 200, 'User fetched', { user });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/admin/users/:id/status ───────────────────────────────────────
const updateUserStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const { id } = req.params;

    if (id === req.user.id) {
      return errorResponse(res, 400, 'You cannot change your own status');
    }

    const targetUser = await UserModel.findById(id);
    if (!targetUser) return errorResponse(res, 404, 'User not found');

    if (targetUser.role === 'admin') {
      return errorResponse(res, 403, 'Cannot modify another admin account');
    }

    const updated = await UserModel.updateStatus(id, status);

    await AuditLogModel.log({
      userId: req.user.id,
      action: `USER_STATUS_CHANGED_TO_${status.toUpperCase()}`,
      entity: 'users',
      entityId: id,
      meta: { previous_status: targetUser.status, new_status: status },
      ipAddress: req.ip,
    });

    logger.info(`Admin ${req.user.id} set user ${id} status to ${status}`);
    return successResponse(res, 200, `User status updated to ${status}`, { user: updated });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/admin/users/:id ─────────────────────────────────────────────
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (id === req.user.id) {
      return errorResponse(res, 400, 'You cannot delete your own account');
    }

    const targetUser = await UserModel.findById(id);
    if (!targetUser) return errorResponse(res, 404, 'User not found');

    if (targetUser.role === 'admin') {
      return errorResponse(res, 403, 'Cannot delete another admin account');
    }

    await UserModel.delete(id);

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'USER_DELETED',
      entity: 'users',
      entityId: id,
      meta: { deleted_user_phone: targetUser.phone, deleted_user_role: targetUser.role },
      ipAddress: req.ip,
    });

    logger.warn(`Admin ${req.user.id} deleted user ${id}`);
    return successResponse(res, 200, 'User deleted successfully');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getAllUsers,
  getUserById,
  updateUserStatus,
  deleteUser,
};
