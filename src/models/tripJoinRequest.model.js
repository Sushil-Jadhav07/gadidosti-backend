const pool = require('../config/db');

// Mirrors driver_requests' shape (status enum, who-can-respond) deliberately, just trimmed to
// v1's plain accept/decline (no offer_history/counter/mutual-confirm CAS — see trip.model.js's
// comment on findActiveTripsByDriver and the design note in the part-load plan: a NEW table
// rather than an extension of driver_requests, since driver_requests/finalizeDriverRequest are
// built around first-assignment semantics — flipping truck/driver to on_trip — which must NOT
// happen again here, the target truck already is on_trip).
const SELECT_WITH_JOINS = `
  SELECT tjr.*,
         b.client_id, b.booking_number, b.pickup_location AS pickup, b.drop_location AS drop_location,
         b.weight, b.weight_unit,
         t.registration AS truck_reg, t.category AS truck_category,
         client.name AS client_name, client.phone AS client_phone,
         driver.name AS driver_name, driver.phone AS driver_phone,
         broker.name AS broker_name, broker.phone AS broker_phone
  FROM trip_join_requests tjr
  JOIN bookings b     ON b.id = tjr.booking_id
  JOIN trucks t       ON t.id = tjr.truck_id
  JOIN users client   ON client.id = b.client_id
  JOIN users driver   ON driver.id = tjr.driver_id
  JOIN users broker   ON broker.id = tjr.broker_id
`;

class TripJoinRequestModel {
  static async create({ bookingId, targetTripId, truckId, driverId, brokerId, amount }) {
    const result = await pool.query(
      `INSERT INTO trip_join_requests (booking_id, target_trip_id, truck_id, driver_id, broker_id, amount)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [bookingId, targetTripId, truckId, driverId, brokerId, amount || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE tjr.id = $1`, [id]);
    return result.rows[0] || null;
  }

  // trip_join_requests.booking_id is UNIQUE — a part-load booking has at most one live request.
  static async findByBookingId(bookingId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE tjr.booking_id = $1`, [bookingId]);
    return result.rows[0] || null;
  }

  static async findByDriver(driverId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const countResult = await pool.query(`SELECT COUNT(*) FROM trip_join_requests WHERE driver_id = $1`, [driverId]);
    const total = parseInt(countResult.rows[0].count);
    const rows = await pool.query(
      `${SELECT_WITH_JOINS} WHERE tjr.driver_id = $1 ORDER BY tjr.created_at DESC LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );
    return { requests: rows.rows, total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / limit) || 0 };
  }

  // Mirrors driver_requests' findTimedOutByBroker — the broker's actionable queue, once the
  // driver hasn't responded in time.
  static async findTimedOutByBroker(brokerId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM trip_join_requests WHERE broker_id = $1 AND driver_timeout_at IS NOT NULL AND status = 'pending'`,
      [brokerId]
    );
    const total = parseInt(countResult.rows[0].count);
    const rows = await pool.query(
      `${SELECT_WITH_JOINS} WHERE tjr.broker_id = $1 AND tjr.driver_timeout_at IS NOT NULL AND tjr.status = 'pending'
       ORDER BY tjr.created_at DESC LIMIT $2 OFFSET $3`,
      [brokerId, limit, offset]
    );
    return { requests: rows.rows, total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / limit) || 0 };
  }

  // Plain CAS accept — v1 has no negotiation, so this is a single-step 'pending' -> 'accepted',
  // unlike driver_requests' dual-purpose mutual-confirm version.
  static async accept(id) {
    const result = await pool.query(
      `UPDATE trip_join_requests SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async decline(id) {
    const result = await pool.query(
      `UPDATE trip_join_requests SET status = 'declined' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Mirrors driver_requests' rollbackAccepted — if finalizing the accept fails after the CAS
  // above already flipped this row (e.g. the capacity/trip re-validation in the controller
  // rejects it), it must roll back from its ACTUAL current status ('accepted'), not 'pending'.
  static async rollbackAccepted(id) {
    const result = await pool.query(
      `UPDATE trip_join_requests SET status = 'declined' WHERE id = $1 AND status = 'accepted' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  static async findOverdueForDriverResponse(timeoutMinutes) {
    const result = await pool.query(
      `SELECT tjr.id, tjr.booking_id, tjr.broker_id, tjr.driver_id, b.booking_number
       FROM trip_join_requests tjr
       JOIN bookings b ON b.id = tjr.booking_id
       WHERE tjr.status = 'pending'
         AND tjr.driver_timeout_at IS NULL
         AND tjr.created_at <= NOW() - ($1 || ' minutes')::INTERVAL`,
      [timeoutMinutes]
    );
    return result.rows;
  }

  static async markDriverTimedOut(id) {
    const result = await pool.query(
      `UPDATE trip_join_requests SET driver_timeout_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Second-stage sweep target — mirrors driver_requests' own version. The broker's turn
  // (driver_timeout_at set, still 'pending') for longer than timeoutMinutes since the driver
  // timed out.
  static async findOverdueForBrokerResponse(timeoutMinutes) {
    const result = await pool.query(
      `SELECT tjr.id, tjr.booking_id, tjr.broker_id, tjr.driver_id, b.booking_number, b.client_id
       FROM trip_join_requests tjr
       JOIN bookings b ON b.id = tjr.booking_id
       WHERE tjr.status = 'pending'
         AND tjr.driver_timeout_at IS NOT NULL
         AND tjr.driver_timeout_at <= NOW() - ($1 || ' minutes')::INTERVAL`,
      [timeoutMinutes]
    );
    return result.rows;
  }
}

module.exports = TripJoinRequestModel;
