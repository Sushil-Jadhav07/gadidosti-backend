const pool = require('../config/db');

// Dedicated "who/when/why" history for a booking's driver reassignments — the reassignment
// mechanism itself lives in job.controller.js's assignDriver (reused whenever a trip already
// exists for the booking); this is purely the audit trail, since before this feature the only
// record of a reassignment was a generic audit_logs row with no captured reason.
const SELECT_WITH_JOINS = `
  SELECT dr.*,
         from_driver.name AS from_driver_name,
         to_driver.name   AS to_driver_name,
         reassigner.name  AS reassigned_by_name
  FROM driver_reassignments dr
  LEFT JOIN users from_driver ON from_driver.id = dr.from_driver_id
  JOIN users to_driver        ON to_driver.id = dr.to_driver_id
  JOIN users reassigner       ON reassigner.id = dr.reassigned_by
`;

class DriverReassignmentModel {
  static async create({ bookingId, tripId, fromDriverId, toDriverId, fromTruckId, toTruckId, reason, reassignedBy }) {
    const result = await pool.query(
      `INSERT INTO driver_reassignments (booking_id, trip_id, from_driver_id, to_driver_id, from_truck_id, to_truck_id, reason, reassigned_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [bookingId, tripId || null, fromDriverId || null, toDriverId, fromTruckId || null, toTruckId || null, reason || null, reassignedBy]
    );
    return result.rows[0];
  }

  static async findByBooking(bookingId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE dr.booking_id = $1 ORDER BY dr.created_at DESC`, [bookingId]);
    return result.rows;
  }
}

module.exports = DriverReassignmentModel;
