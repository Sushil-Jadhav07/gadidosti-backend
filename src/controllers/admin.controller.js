const AnalyticsModel = require('../models/analytics.model');
const AdminSettingsModel = require('../models/adminSettings.model');
const AuditLogModel = require('../models/auditLog.model');
const { successResponse, errorResponse } = require('../utils/response');

// ─── GET /api/admin/dashboard ─────────────────────────────────────────────────
const getDashboard = async (req, res, next) => {
  try {
    const stats = await AnalyticsModel.dashboard();
    return successResponse(res, 200, 'Dashboard stats fetched', stats);
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/analytics/admin ─────────────────────────────────────────────────
const getAdminAnalytics = async (req, res, next) => {
  try {
    const [gmvOverMonths, revenueOverMonths, topClients, fleetUtilization, bookingConversionSparkline] = await Promise.all([
      AnalyticsModel.gmvOverMonths(),
      AnalyticsModel.revenueOverMonths(),
      AnalyticsModel.topClients(),
      AnalyticsModel.fleetUtilization(),
      AnalyticsModel.bookingConversionSparkline(),
    ]);

    return successResponse(res, 200, 'Admin analytics fetched', {
      gmvOverMonths, revenueOverMonths, topClients, fleetUtilization, bookingConversionSparkline,
    });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/settings ──────────────────────────────────────────────────
const getSettings = async (req, res, next) => {
  try {
    const settings = await AdminSettingsModel.get();
    if (!settings) return errorResponse(res, 404, 'Settings not found');

    return successResponse(res, 200, 'Settings fetched', {
      platformName: settings.platform_name,
      contactEmail: settings.contact_email,
      commissionRate: settings.commission_rate,
      emailAlerts: settings.email_alerts,
      smsAlerts: settings.sms_alerts,
      pushNotifications: settings.push_notifications,
      updatedAt: settings.updated_at,
    });
  } catch (err) {
    next(err);
  }
};

// ─── PUT /api/admin/settings ──────────────────────────────────────────────────
const updateSettings = async (req, res, next) => {
  try {
    const { platform_name, contact_email, commission_rate, email_alerts, sms_alerts, push_notifications } = req.body;

    const updated = await AdminSettingsModel.update({
      platformName: platform_name,
      contactEmail: contact_email,
      commissionRate: commission_rate,
      emailAlerts: email_alerts,
      smsAlerts: sms_alerts,
      pushNotifications: push_notifications,
    });
    if (!updated) return errorResponse(res, 404, 'Settings not found');

    await AuditLogModel.log({
      userId: req.user.id,
      action: 'ADMIN_SETTINGS_UPDATED',
      entity: 'admin_settings',
      entityId: updated.id,
      meta: { fields: Object.keys(req.body) },
      ipAddress: req.ip,
    });

    return successResponse(res, 200, 'Settings updated', {
      platformName: updated.platform_name,
      contactEmail: updated.contact_email,
      commissionRate: updated.commission_rate,
      emailAlerts: updated.email_alerts,
      smsAlerts: updated.sms_alerts,
      pushNotifications: updated.push_notifications,
      updatedAt: updated.updated_at,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getDashboard, getAdminAnalytics, getSettings, updateSettings };
