const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT jr.*,
         b.booking_number, b.pickup_location AS pickup, b.drop_location AS drop_location,
         b.truck_type, b.weight, b.weight_unit,
         client.name AS client_name, client.phone AS client_phone
  FROM job_requests jr
  JOIN bookings b ON b.id = jr.booking_id
  JOIN users client ON client.id = b.client_id
`;

class JobRequestModel {
  static async create({ bookingId, brokerId, distance, amount, expiryMinutes = 30 }) {
    const result = await pool.query(
      `INSERT INTO job_requests (booking_id, broker_id, distance, amount, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)
       RETURNING *`,
      [bookingId, brokerId, distance || null, amount || null, expiryMinutes]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE jr.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByBookingId(bookingId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE jr.booking_id = $1 ORDER BY jr.created_at DESC`, [bookingId]);
    return result.rows;
  }

  // Auto-lapses anything past its expiry before reading — job requests are a TTL feature.
  static async findByBroker(brokerId, { page = 1, limit = 10 } = {}) {
    await pool.query(
      `UPDATE job_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW()`
    );

    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM job_requests WHERE broker_id = $1`,
      [brokerId]
    );
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} WHERE jr.broker_id = $1 ORDER BY jr.created_at DESC LIMIT $2 OFFSET $3`,
      [brokerId, limit, offset]
    );

    return {
      requests: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async setStatus(id, status) {
    const result = await pool.query(
      `UPDATE job_requests SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  // Atomic compare-and-swap — only flips pending -> accepted, so two brokers racing on
  // *their own* job_request row for the same booking can't both "win" it.
  static async acceptIfPending(id) {
    const result = await pool.query(
      `UPDATE job_requests SET status = 'accepted' WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Declines every other still-pending request for the same booking once one broker has won it.
  static async declineOthersForBooking(bookingId, exceptJobRequestId) {
    await pool.query(
      `UPDATE job_requests SET status = 'declined' WHERE booking_id = $1 AND id != $2 AND status = 'pending'`,
      [bookingId, exceptJobRequestId]
    );
  }

  // Background sweep counterpart to findByBroker's inline lazy-expiry — flips every
  // pending request whose expiry has passed, regardless of broker. Returns the distinct
  // booking_ids touched so the caller can check whether a booking just lost its last offer.
  static async expirePending() {
    const result = await pool.query(
      `UPDATE job_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < NOW() RETURNING booking_id`
    );
    return [...new Set(result.rows.map((row) => row.booking_id))];
  }

  // True once every job_request for this booking has lapsed (expired/declined) with
  // none accepted — i.e. nobody is going to pick this booking up on their own.
  static async allLapsedForBooking(bookingId) {
    const result = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE status IN ('pending', 'accepted')) AS live
       FROM job_requests WHERE booking_id = $1`,
      [bookingId]
    );
    return parseInt(result.rows[0].live, 10) === 0;
  }
}

module.exports = JobRequestModel;
