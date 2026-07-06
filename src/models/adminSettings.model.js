const pool = require('../config/db');

// Fixed singleton row id — see db/10settings_pricing.sql
const ADMIN_SETTINGS_ID = '00000000-0000-0000-0000-000000000002';

class AdminSettingsModel {
  static async get() {
    const result = await pool.query(`SELECT * FROM admin_settings WHERE id = $1`, [ADMIN_SETTINGS_ID]);
    return result.rows[0] || null;
  }

  static async update({ platformName, contactEmail, commissionRate, emailAlerts, smsAlerts, pushNotifications }) {
    const result = await pool.query(
      `UPDATE admin_settings SET
         platform_name = COALESCE($1, platform_name),
         contact_email = COALESCE($2, contact_email),
         commission_rate = COALESCE($3, commission_rate),
         email_alerts = COALESCE($4, email_alerts),
         sms_alerts = COALESCE($5, sms_alerts),
         push_notifications = COALESCE($6, push_notifications),
         updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [platformName, contactEmail, commissionRate, emailAlerts, smsAlerts, pushNotifications, ADMIN_SETTINGS_ID]
    );
    return result.rows[0] || null;
  }
}

module.exports = AdminSettingsModel;
