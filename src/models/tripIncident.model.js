const pool = require('../config/db');

class TripIncidentModel {
  static async create({ tripId, driverId, reason, notes }) {
    const result = await pool.query(
      `INSERT INTO trip_incidents (trip_id, driver_id, reason, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [tripId, driverId, reason, notes || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM trip_incidents WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByTrip(tripId) {
    const result = await pool.query(
      `SELECT * FROM trip_incidents WHERE trip_id = $1 ORDER BY reported_at DESC`,
      [tripId]
    );
    return result.rows;
  }

  static async findLatestUnresolvedByTrip(tripId) {
    const result = await pool.query(
      `SELECT * FROM trip_incidents WHERE trip_id = $1 AND status != 'resolved' ORDER BY reported_at DESC LIMIT 1`,
      [tripId]
    );
    return result.rows[0] || null;
  }

  static async resolve(id, resolution) {
    const result = await pool.query(
      `UPDATE trip_incidents SET status = 'resolved', resolution = $1, resolved_at = NOW() WHERE id = $2 RETURNING *`,
      [resolution, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = TripIncidentModel;
