const NotificationModel = require('../models/notification.model');
const DeviceTokenModel = require('../models/deviceToken.model');
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

// ─── POST /api/users/device-token ─────────────────────────────────────────────
// Call once after login (and again whenever the FCM SDK hands the app a fresh token — it
// can rotate) from every platform: web, Android, iOS. Re-registering an existing token just
// reassigns it to the current user (see DeviceTokenModel.upsert) — safe to call on every app
// launch without checking whether it's already registered.
const registerDeviceToken = async (req, res, next) => {
  try {
    const { token, platform } = req.body;
    const saved = await DeviceTokenModel.upsert({ userId: req.user.id, token, platform });
    return successResponse(res, 200, 'Device token registered', { deviceToken: saved });
  } catch (err) {
    next(err);
  }
};

// ─── DELETE /api/users/device-token ───────────────────────────────────────────
// Call on logout so a signed-out device stops receiving this user's pushes.
const unregisterDeviceToken = async (req, res, next) => {
  try {
    const { token } = req.body;
    await DeviceTokenModel.remove(token);
    return successResponse(res, 200, 'Device token unregistered');
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getNotifications, markNotificationRead, markAllNotificationsRead,
  registerDeviceToken, unregisterDeviceToken,
};
