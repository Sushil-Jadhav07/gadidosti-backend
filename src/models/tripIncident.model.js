const pool = require('../config/db');

// Every read joins in the linked mechanic_requests row (null unless reason='breakdown') so
// callers get mechanic assignment status without a separate query per incident.
const MECHANIC_JOIN = `
  LEFT JOIN mechanic_requests mr ON mr.trip_incident_id = ti.id
`;
const MECHANIC_COLUMNS = `
  mr.id AS mechanic_request_id, mr.status AS mechanic_status,
  mr.mechanic_name AS mechanic_name, mr.mechanic_phone AS mechanic_phone,
  mr.notes AS mechanic_notes, mr.updated_at AS mechanic_updated_at
`;

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
    const result = await pool.query(
      `SELECT ti.*, ${MECHANIC_COLUMNS} FROM trip_incidents ti ${MECHANIC_JOIN} WHERE ti.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async findByTrip(tripId) {
    const result = await pool.query(
      `SELECT ti.*, ${MECHANIC_COLUMNS} FROM trip_incidents ti ${MECHANIC_JOIN}
       WHERE ti.trip_id = $1 ORDER BY ti.reported_at DESC`,
      [tripId]
    );
    return result.rows;
  }

  static async findLatestUnresolvedByTrip(tripId) {
    const result = await pool.query(
      `SELECT ti.*, ${MECHANIC_COLUMNS} FROM trip_incidents ti ${MECHANIC_JOIN}
       WHERE ti.trip_id = $1 AND ti.status != 'resolved' ORDER BY ti.reported_at DESC LIMIT 1`,
      [tripId]
    );
    return result.rows[0] || null;
  }

  // GET /api/admin/incidents — platform-wide, not scoped to one trip, with enough joined
  // context (booking/driver/broker) that admin doesn't need to already know a trip ID.
  static async findAllOpen({ page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM trip_incidents WHERE status != 'resolved'`
    );
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `SELECT ti.*, ${MECHANIC_COLUMNS},
              t.booking_id, b.booking_number,
              driver.name AS driver_name, driver.phone AS driver_phone,
              broker.id AS broker_id, broker.name AS broker_name, broker.phone AS broker_phone
       FROM trip_incidents ti
       JOIN trips t ON t.id = ti.trip_id
       JOIN bookings b ON b.id = t.booking_id
       LEFT JOIN users driver ON driver.id = ti.driver_id
       LEFT JOIN users broker ON broker.id = t.broker_id
       ${MECHANIC_JOIN}
       WHERE ti.status != 'resolved'
       ORDER BY ti.reported_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    return {
      incidents: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async countOpen() {
    const result = await pool.query(`SELECT COUNT(*) FROM trip_incidents WHERE status != 'resolved'`);
    return parseInt(result.rows[0].count, 10);
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
