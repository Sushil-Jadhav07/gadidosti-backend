const pool = require('../config/db');

class MechanicRequestModel {
  static async create({ tripIncidentId, notes }) {
    const result = await pool.query(
      `INSERT INTO mechanic_requests (trip_incident_id, notes) VALUES ($1, $2) RETURNING *`,
      [tripIncidentId, notes || null]
    );
    return result.rows[0];
  }

  static async findByIncidentId(tripIncidentId) {
    const result = await pool.query(`SELECT * FROM mechanic_requests WHERE trip_incident_id = $1`, [tripIncidentId]);
    return result.rows[0] || null;
  }

  static async update(id, { status, mechanicName, mechanicPhone, notes }) {
    const result = await pool.query(
      `UPDATE mechanic_requests
       SET status = COALESCE($1, status),
           mechanic_name = COALESCE($2, mechanic_name),
           mechanic_phone = COALESCE($3, mechanic_phone),
           notes = COALESCE($4, notes)
       WHERE id = $5
       RETURNING *`,
      [status || null, mechanicName || null, mechanicPhone || null, notes || null, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = MechanicRequestModel;
