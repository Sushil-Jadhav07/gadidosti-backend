const pool = require('../config/db');

// Which GPS tracker devices (by raw IMEI, matching the vendor's own identifier — no dependency
// on whether that IMEI has been linked to one of our truck records) a gps_owner account is
// allowed to see — admin-granted, scoped per account (see Users.jsx's Device Access editor).
// admin/staff are never scoped by this table at all; only tracking.controller.js's gps_owner
// branch ever reads it.
class GpsOwnerDeviceModel {
  static async findGrantedImeis(gpsOwnerId) {
    const result = await pool.query(`SELECT device_imei FROM gps_owner_devices WHERE gps_owner_id = $1`, [gpsOwnerId]);
    return result.rows.map((r) => r.device_imei);
  }

  // Replaces the full set, not a merge — same convention as UserModel.updatePagePermissions
  // (the admin UI always sends the complete desired list, so a device unchecked there must
  // actually disappear, not just skip being re-added).
  static async setGrantedImeis(gpsOwnerId, deviceImeis) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM gps_owner_devices WHERE gps_owner_id = $1`, [gpsOwnerId]);
      if (deviceImeis.length) {
        const values = deviceImeis.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO gps_owner_devices (gps_owner_id, device_imei) VALUES ${values} ON CONFLICT DO NOTHING`,
          [gpsOwnerId, ...deviceImeis]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = GpsOwnerDeviceModel;
