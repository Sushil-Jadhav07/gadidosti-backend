const NotificationModel = require('../models/notification.model');
const { successResponse, errorResponse } = require('../utils/response');

// ─── GET /api/users/notifications ─────────────────────────────────────────────
const getNotifications = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const result = await NotificationModel.findByUser(req.user.id, {
      page: parseInt(page),
      limit: Math.min(parseInt(limit), 100),
    });

    return successResponse(res, 200, 'Notifications fetched', result);
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/users/notifications/:id/read ──────────────────────────────────
const markNotificationRead = async (req, res, next) => {
  try {
    const notification = await NotificationModel.markRead(req.params.id, req.user.id);
    if (!notification) return errorResponse(res, 404, 'Notification not found');
    return successResponse(res, 200, 'Notification marked as read', { notification });
  } catch (err) {
    next(err);
  }
};

// ─── PATCH /api/users/notifications/read-all ──────────────────────────────────
const markAllNotificationsRead = async (req, res, next) => {
  try {
    const updated = await NotificationModel.markAllRead(req.user.id);
    return successResponse(res, 200, 'All notifications marked as read', { updated });
  } catch (err) {
    next(err);
  }
};

module.exports = { getNotifications, markNotificationRead, markAllNotificationsRead };
