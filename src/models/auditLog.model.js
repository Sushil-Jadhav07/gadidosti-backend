const pool = require('../config/db');

class AuditLogModel {
  static async log({ userId, action, entity, entityId, meta, ipAddress }) {
    try {
      await pool.query(
        `INSERT INTO audit_logs (user_id, action, entity, entity_id, meta, ip_address)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId || null, action, entity || null, entityId || null, meta ? JSON.stringify(meta) : null, ipAddress || null]
      );
    } catch (err) {
      // Non-blocking — audit log failures should not crash the app
      console.error('Audit log failed:', err.message);
    }
  }
}

module.exports = AuditLogModel;
