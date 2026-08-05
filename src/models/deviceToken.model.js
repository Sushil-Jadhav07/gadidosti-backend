const pool = require('../config/db');

class DeviceTokenModel {
  // Re-registering an existing token (app reinstall, or a different account logging into the
  // same device) reassigns it to the new user rather than erroring — a physical token can
  // only ever belong to whoever is currently logged in on that device.
  static async upsert({ userId, token, platform }) {
    const result = await pool.query(
      `INSERT INTO device_tokens (user_id, token, platform)
       VALUES ($1, $2, $3)
       ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = NOW()
       RETURNING id, user_id, token, platform, created_at`,
      [userId, token, platform || null]
    );
    return result.rows[0];
  }

  static async remove(token) {
    await pool.query(`DELETE FROM device_tokens WHERE token = $1`, [token]);
  }

  static async findTokensByUserId(userId) {
    const result = await pool.query(`SELECT token FROM device_tokens WHERE user_id = $1`, [userId]);
    return result.rows.map((row) => row.token);
  }

  // Prunes tokens FCM reported as dead (uninstalled app, revoked, etc.) — called from
  // NotificationModel.create after every push send.
  static async removeMany(tokens) {
    if (!tokens?.length) return;
    await pool.query(`DELETE FROM device_tokens WHERE token = ANY($1)`, [tokens]);
  }
}

module.exports = DeviceTokenModel;
