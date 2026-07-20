const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT jr.*,
         b.client_id, b.booking_number, b.pickup_location AS pickup, b.drop_location AS drop_location,
         b.truck_type, b.weight, b.weight_unit,
         client.name AS client_name, client.phone AS client_phone,
         broker.name AS broker_name, broker.phone AS broker_phone
  FROM job_requests jr
  JOIN bookings b ON b.id = jr.booking_id
  JOIN users client ON client.id = b.client_id
  JOIN users broker ON broker.id = jr.broker_id
`;

class JobRequestModel {
  // Seeds offer_history with the client's starting ask (whichever price the booking was
  // created with — system-calculated or client-proposed) so the first entry is never blank.
  static async create({ bookingId, brokerId, distance, amount }) {
    const initialHistory = JSON.stringify([{ by: 'client', amount: amount || null, note: null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `INSERT INTO job_requests (booking_id, broker_id, distance, amount, offer_history)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING *`,
      [bookingId, brokerId, distance || null, amount || null, initialHistory]
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

  static async findByBroker(brokerId, { page = 1, limit = 10 } = {}) {
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

  // Declines every other still-open (pending or mid-negotiation) request for the same booking
  // once one broker has won it.
  static async declineOthersForBooking(bookingId, exceptJobRequestId) {
    await pool.query(
      `UPDATE job_requests SET status = 'declined' WHERE booking_id = $1 AND id != $2 AND status IN ('pending', 'countered')`,
      [bookingId, exceptJobRequestId]
    );
  }

  // Broker submits a counter-offer — only while the request is awaiting the broker's response
  // ('pending'). Flips to 'countered' so the client sees it and can respond next.
  static async brokerCounter(id, { amount, note }) {
    const entry = JSON.stringify([{ by: 'broker', amount, note: note || null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `UPDATE job_requests
       SET amount = $1, status = 'countered', offer_history = offer_history || $2::jsonb
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [amount, entry, id]
    );
    return result.rows[0] || null;
  }

  // Client counters a specific broker's offer back — only while awaiting the client's response
  // ('countered'). Flips back to 'pending' so that broker sees it and can respond again.
  static async clientCounter(id, { amount, note }) {
    const entry = JSON.stringify([{ by: 'client', amount, note: note || null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `UPDATE job_requests
       SET amount = $1, status = 'pending', offer_history = offer_history || $2::jsonb
       WHERE id = $3 AND status = 'countered'
       RETURNING *`,
      [amount, entry, id]
    );
    return result.rows[0] || null;
  }

  // Client accepts a broker's counter-offer — atomic compare-and-swap from 'countered', mirrors
  // acceptIfPending's role on the broker side.
  static async clientAcceptIfCountered(id) {
    const result = await pool.query(
      `UPDATE job_requests SET status = 'accepted' WHERE id = $1 AND status = 'countered' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Client rejects a broker's counter-offer — atomic compare-and-swap from 'countered'.
  static async clientRejectIfCountered(id) {
    const result = await pool.query(
      `UPDATE job_requests SET status = 'declined' WHERE id = $1 AND status = 'countered' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

}

module.exports = JobRequestModel;
