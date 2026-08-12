const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT dr.*,
         b.client_id, b.booking_number, b.pickup_location AS pickup, b.drop_location AS drop_location,
         b.weight, b.weight_unit,
         t.registration AS truck_reg, t.type AS truck_type, t.category AS truck_category,
         client.name AS client_name, client.phone AS client_phone,
         driver.name AS driver_name, driver.phone AS driver_phone,
         broker.name AS broker_name, broker.phone AS broker_phone
  FROM driver_requests dr
  JOIN bookings b     ON b.id = dr.booking_id
  JOIN trucks t       ON t.id = dr.truck_id
  JOIN users client   ON client.id = b.client_id
  JOIN users driver   ON driver.id = dr.driver_id
  JOIN users broker   ON broker.id = dr.broker_id
`;

class DriverRequestModel {
  // Seeds offer_history with the client's starting ask (the booking's estimated amount) so
  // the first entry is never blank — same convention as JobRequestModel.create. jobRequestId
  // is only set for the broker-assign origin (broker picked this driver for an already-
  // negotiated job_requests booking) — null for the direct client-pick origin.
  static async create({ bookingId, truckId, driverId, brokerId, amount, jobRequestId }) {
    const initialHistory = JSON.stringify([{ by: 'client', amount: amount || null, note: null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `INSERT INTO driver_requests (booking_id, truck_id, driver_id, broker_id, amount, offer_history, job_request_id)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
       RETURNING *`,
      [bookingId, truckId, driverId, brokerId, amount || null, initialHistory, jobRequestId || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE dr.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findByBookingId(bookingId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE dr.booking_id = $1 ORDER BY dr.created_at DESC`, [bookingId]);
    return result.rows;
  }

  static async findByDriver(driverId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const countResult = await pool.query(`SELECT COUNT(*) FROM driver_requests WHERE driver_id = $1`, [driverId]);
    const total = parseInt(countResult.rows[0].count);
    const rows = await pool.query(
      `${SELECT_WITH_JOINS} WHERE dr.driver_id = $1 ORDER BY dr.created_at DESC LIMIT $2 OFFSET $3`,
      [driverId, limit, offset]
    );
    return { requests: rows.rows, total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / limit) || 0 };
  }

  // A broker's actionable queue is narrower than "all requests for my fleet" — only ones
  // where the driver has actually timed out are theirs to act on (driver_timeout_at set).
  static async findTimedOutByBroker(brokerId, { page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const countResult = await pool.query(
      `SELECT COUNT(*) FROM driver_requests WHERE broker_id = $1 AND driver_timeout_at IS NOT NULL`,
      [brokerId]
    );
    const total = parseInt(countResult.rows[0].count);
    const rows = await pool.query(
      `${SELECT_WITH_JOINS} WHERE dr.broker_id = $1 AND dr.driver_timeout_at IS NOT NULL ORDER BY dr.created_at DESC LIMIT $2 OFFSET $3`,
      [brokerId, limit, offset]
    );
    return { requests: rows.rows, total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / limit) || 0 };
  }

  // Declines every other still-open request for the same booking once one is accepted —
  // e.g. the client had requested two trucks in parallel. Includes 'awaiting_confirmation' —
  // a sibling parked mid-handshake on a booking that's just been won elsewhere must die too,
  // otherwise it could still complete its own second-confirm CAS after the fact (zombie state).
  static async declineOthersForBooking(bookingId, exceptRequestId) {
    await pool.query(
      `UPDATE driver_requests SET status = 'declined' WHERE booking_id = $1 AND id != $2 AND status IN ('pending', 'countered', 'awaiting_confirmation')`,
      [bookingId, exceptRequestId]
    );
  }

  // Used when the client cancels a booking outright — there's no "winning" request to
  // except, every still-open request for it is now moot (mirrors JobRequestModel's
  // declineAllForBooking).
  static async declineAllForBooking(bookingId) {
    await pool.query(
      `UPDATE driver_requests SET status = 'declined' WHERE booking_id = $1 AND status IN ('pending', 'countered', 'awaiting_confirmation')`,
      [bookingId]
    );
  }

  // Driver (or broker, once driver_timeout_at is set) counters — only while 'pending'
  // (their turn). Flips to 'countered' so the client sees it and responds next. `actor` is
  // recorded in offer_history as 'driver' or 'broker' so the client can tell who they're
  // actually negotiating with.
  static async respondentCounter(id, { amount, note, actor }) {
    const entry = JSON.stringify([{ by: actor, amount, note: note || null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `UPDATE driver_requests
       SET amount = $1, status = 'countered', offer_history = offer_history || $2::jsonb
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [amount, entry, id]
    );
    return result.rows[0] || null;
  }

  // Also valid out of 'awaiting_confirmation' when the CLIENT committed first and the
  // respondent is now rejecting that commitment instead of confirming it.
  static async respondentDecline(id) {
    const result = await pool.query(
      `UPDATE driver_requests
       SET status = 'declined'
       WHERE id = $1
         AND (status = 'pending' OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'client'))
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Driver (or broker) agrees at the current amount — dual-purpose, mutual-confirmation CAS.
  // From 'pending': this is the FIRST side to commit — parks at 'awaiting_confirmation'
  // (pending_confirmation_by = 'respondent') and waits for the client to also confirm; nothing
  // is finalized yet. From 'awaiting_confirmation' with pending_confirmation_by = 'client': the
  // client already committed, so this call is the second, finalizing confirmation — status
  // flips straight to 'accepted'. The caller (controller) branches on the returned row's
  // status to know which case happened.
  static async respondentAccept(id) {
    const result = await pool.query(
      `UPDATE driver_requests SET
         status = CASE WHEN status = 'pending' THEN 'awaiting_confirmation' ELSE 'accepted' END,
         pending_confirmation_by = CASE WHEN status = 'pending' THEN 'respondent' ELSE pending_confirmation_by END
       WHERE id = $1
         AND (status = 'pending' OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'client'))
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Fixes a real bug: when finalizeDriverRequest() fails after this row was already flipped to
  // 'accepted' by the CAS above (the booking was won by the other negotiation path in the
  // meantime), the caller must roll this row back to 'declined' — but it must CAS from the
  // row's *actual* current status ('accepted'), not 'pending', or the UPDATE silently no-ops
  // and leaves the row permanently stuck 'accepted' with no real trip behind it.
  static async rollbackAccepted(id) {
    const result = await pool.query(
      `UPDATE driver_requests SET status = 'declined' WHERE id = $1 AND status = 'accepted' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Client proposes a new amount — leaves it 'pending' (driver/broker's turn again), whether
  // this is a reply to their counter ('countered') or the client renegotiating proactively
  // before any response yet ('pending').
  static async clientCounter(id, { amount, note }) {
    const entry = JSON.stringify([{ by: 'client', amount, note: note || null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `UPDATE driver_requests
       SET amount = $1, status = 'pending', offer_history = offer_history || $2::jsonb, driver_timeout_at = NULL
       WHERE id = $3 AND status IN ('pending', 'countered')
       RETURNING *`,
      [amount, entry, id]
    );
    return result.rows[0] || null;
  }

  // Client locks in the driver/broker's current offer — same dual-purpose mutual-confirmation
  // CAS as respondentAccept above, mirrored: from 'pending'/'countered' this is the client
  // committing first (parks at 'awaiting_confirmation', pending_confirmation_by = 'client');
  // from 'awaiting_confirmation' with pending_confirmation_by = 'respondent', this is the
  // client's finalizing confirmation of the respondent's prior commitment -> 'accepted'.
  static async clientAcceptIfCountered(id) {
    const result = await pool.query(
      `UPDATE driver_requests SET
         status = CASE WHEN status IN ('pending', 'countered') THEN 'awaiting_confirmation' ELSE 'accepted' END,
         pending_confirmation_by = CASE WHEN status IN ('pending', 'countered') THEN 'client' ELSE pending_confirmation_by END
       WHERE id = $1
         AND (status IN ('pending', 'countered') OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'respondent'))
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Also valid out of 'awaiting_confirmation' when the RESPONDENT committed first and the
  // client is now rejecting that commitment instead of confirming it.
  static async clientRejectIfCountered(id) {
    const result = await pool.query(
      `UPDATE driver_requests
       SET status = 'declined'
       WHERE id = $1
         AND (status = 'countered' OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'respondent'))
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Sweep target: still awaiting the driver's response (status='pending', never timed out
  // yet) for longer than timeoutMinutes since it last became their turn — updated_at reflects
  // that moment, since both create() and clientCounter() (which resets status to 'pending')
  // touch the row.
  static async findOverdueForDriverResponse(timeoutMinutes) {
    const result = await pool.query(
      `SELECT dr.id, dr.booking_id, dr.broker_id, dr.driver_id, b.booking_number
       FROM driver_requests dr
       JOIN bookings b ON b.id = dr.booking_id
       WHERE dr.status = 'pending'
         AND dr.driver_timeout_at IS NULL
         AND dr.updated_at <= NOW() - ($1 || ' minutes')::INTERVAL`,
      [timeoutMinutes]
    );
    return result.rows;
  }

  static async markDriverTimedOut(id) {
    const result = await pool.query(
      `UPDATE driver_requests SET driver_timeout_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Second-stage sweep target: the broker's turn (driver_timeout_at set, still 'pending' —
  // 'countered' means it's actually back on the client, not the broker) for longer than
  // timeoutMinutes since the driver timed out.
  static async findOverdueForBrokerResponse(timeoutMinutes) {
    const result = await pool.query(
      `SELECT dr.id, dr.booking_id, dr.broker_id, dr.driver_id, dr.job_request_id, b.client_id, b.booking_number
       FROM driver_requests dr
       JOIN bookings b ON b.id = dr.booking_id
       WHERE dr.status = 'pending'
         AND dr.driver_timeout_at IS NOT NULL
         AND dr.driver_timeout_at <= NOW() - ($1 || ' minutes')::INTERVAL`,
      [timeoutMinutes]
    );
    return result.rows;
  }
}

module.exports = DriverRequestModel;
