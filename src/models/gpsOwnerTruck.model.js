const pool = require('../config/db');

// Which trucks a gps_owner account is allowed to see — admin-granted, scoped per account (see
// Users.jsx's Truck Access editor). admin/staff are never scoped by this table at all; only
// tracking.controller.js's gps_owner branch ever reads it.
class GpsOwnerTruckModel {
  static async findGrantedTruckIds(gpsOwnerId) {
    const result = await pool.query(`SELECT truck_id FROM gps_owner_trucks WHERE gps_owner_id = $1`, [gpsOwnerId]);
    return result.rows.map((r) => r.truck_id);
  }

  // Full truck rows (id, registration, gps_device_imei) for the admin's Truck Access editor and
  // for tracking.controller.js to build its "which IMEIs is this gps_owner allowed to see" set
  // without a second round trip.
  static async findGrantedTrucks(gpsOwnerId) {
    const result = await pool.query(
      `SELECT t.id, t.registration, t.gps_device_imei
       FROM gps_owner_trucks got
       JOIN trucks t ON t.id = got.truck_id
       WHERE got.gps_owner_id = $1
       ORDER BY t.registration ASC`,
      [gpsOwnerId]
    );
    return result.rows;
  }

  // Replaces the full set, not a merge — same convention as UserModel.updatePagePermissions
  // (the admin UI always sends the complete desired list, so a truck unchecked there must
  // actually disappear, not just skip being re-added).
  static async setGrantedTrucks(gpsOwnerId, truckIds) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM gps_owner_trucks WHERE gps_owner_id = $1`, [gpsOwnerId]);
      if (truckIds.length) {
        const values = truckIds.map((_, i) => `($1, $${i + 2})`).join(', ');
        await client.query(
          `INSERT INTO gps_owner_trucks (gps_owner_id, truck_id) VALUES ${values} ON CONFLICT DO NOTHING`,
          [gpsOwnerId, ...truckIds]
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

module.exports = GpsOwnerTruckModel;
