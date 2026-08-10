const pool = require('../config/db');

// Opportunistic cache of each Bolt GPS device's last known position (see
// db/31tracking_last_known.sql) — one row per device, upserted on every successful vendor
// fetch, read as a fallback when the live vendor call fails or a device is briefly offline.
class TrackingLastKnownModel {
  static async upsert({ deviceImei, deviceName, latitude, longitude, speed, course, ignition, raw }) {
    if (!deviceImei) return null;
    const result = await pool.query(
      `INSERT INTO tracking_last_known (device_imei, device_name, latitude, longitude, speed, course, ignition, raw, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (device_imei) DO UPDATE SET
         device_name = EXCLUDED.device_name, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude,
         speed = EXCLUDED.speed, course = EXCLUDED.course, ignition = EXCLUDED.ignition, raw = EXCLUDED.raw,
         recorded_at = NOW()
       RETURNING *`,
      [deviceImei, deviceName || null, latitude ?? null, longitude ?? null, speed ?? null, course ?? null, ignition ?? null, raw ? JSON.stringify(raw) : null]
    );
    return result.rows[0];
  }

  static async findByImei(imei) {
    const result = await pool.query(`SELECT * FROM tracking_last_known WHERE device_imei = $1`, [imei]);
    return result.rows[0] || null;
  }

  static async findByName(name) {
    const result = await pool.query(`SELECT * FROM tracking_last_known WHERE device_name = $1`, [name]);
    return result.rows[0] || null;
  }

  static async findAll() {
    const result = await pool.query(`SELECT * FROM tracking_last_known ORDER BY recorded_at DESC`);
    return result.rows;
  }
}

module.exports = TrackingLastKnownModel;
