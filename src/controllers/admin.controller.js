const AnalyticsModel = require('../models/analytics.model');
const AdminSettingsModel = require('../models/adminSettings.model');
const AuditLogModel = require('../models/auditLog.model');
const TripIncidentModel = require('../models/tripIncident.model');
const { successResponse, errorResponse } = require('../utils/response');

const projectIncident = (row) => ({
  id: row.id,
  tripId: row.trip_id,
  bookingId: row.booking_id,
  bookingNumber: row.booking_number,
  driverId: row.driver_id,
  driverName: row.driver_name || null,
  driverPhone: row.driver_phone || null,
  brokerId: row.broker_id || null,
  brokerName: row.broker_name || null,
  reason: row.reason,
  notes: row.notes,
  status: row.status,
  reportedAt: row.reported_at,
  resolvedAt: row.resolved_at,
  resolution: row.resolution,
});

// ─── GET /api/admin/dashboard ─────────────────────────────────────────────────
const getDashboard = async (req, res, next) => {
  try {
    const [stats, openIncidents] = await Promise.all([
      AnalyticsModel.dashboard(),
      TripIncidentModel.countOpen(),
    ]);
    return successResponse(res, 200, 'Dashboard stats fetched', { ...stats, openIncidents });
  } catch (err) {
    next(err);
  }
};

// ─── GET /api/admin/incidents?status=open ─────────────────────────────────────
// Platform-wide incident list — GET /api/trips/:id/incidents is scoped to one trip and
// requires already knowing a trip ID, which doesn't help admin discover problems in the
// first place. Only 'open' (unresolved) is supported for now since that's the actionable view.
const listOpenIncidents = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await TripIncidentModel.findAllOpen({
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
    });

    return successResponse(res, 200, 'Open incidents fetched', {
      ...result,
      incidents: result.incidents.map(projectIncident),
    });
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

module.exports = { getDashboard, getAdminAnalytics, getSettings, updateSettings, listOpenIncidents };
