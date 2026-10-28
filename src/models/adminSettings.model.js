const pool = require('../config/db');

// Fixed singleton row id — see db/10settings_pricing.sql
const ADMIN_SETTINGS_ID = '00000000-0000-0000-0000-000000000002';

class AdminSettingsModel {
  static async get() {
    const result = await pool.query(`SELECT * FROM admin_settings WHERE id = $1`, [ADMIN_SETTINGS_ID]);
    return result.rows[0] || null;
  }

  // company_gstin/company_legal_name are deliberately NOT settable here — see setCompanyGstin
  // below, the only path that writes them (straight from a verified Cashfree lookup).
  static async update({ platformName, contactEmail, commissionRate, emailAlerts, smsAlerts, pushNotifications, companyUpiId, companyUpiName }) {
    const result = await pool.query(
      `UPDATE admin_settings SET
         platform_name = COALESCE($1, platform_name),
         contact_email = COALESCE($2, contact_email),
         commission_rate = COALESCE($3, commission_rate),
         email_alerts = COALESCE($4, email_alerts),
         sms_alerts = COALESCE($5, sms_alerts),
         push_notifications = COALESCE($6, push_notifications),
         company_upi_id = COALESCE($7, company_upi_id),
         company_upi_name = COALESCE($8, company_upi_name),
         updated_at = NOW()
       WHERE id = $9
       RETURNING *`,
      [platformName, contactEmail, commissionRate, emailAlerts, smsAlerts, pushNotifications, companyUpiId, companyUpiName, ADMIN_SETTINGS_ID]
    );
    return result.rows[0] || null;
  }

  // Separate from update() above — company_gstin/company_legal_name are only ever written
  // together, straight from a successful Cashfree verification (see admin.controller.js's
  // verifyCompanyGstin), never free-typed, so this sets both directly rather than COALESCE-
  // merging against whatever's already there.
  static async setCompanyGstin({ gstin, legalName }) {
    const result = await pool.query(
      `UPDATE admin_settings SET
         company_gstin = $1,
         company_legal_name = $2,
         company_gst_verified_at = NOW(),
         updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [gstin, legalName, ADMIN_SETTINGS_ID]
    );
    return result.rows[0] || null;
  }
}

module.exports = AdminSettingsModel;
