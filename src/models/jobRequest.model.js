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

  // CAS, not a blind write — `fromStatuses` is the set of statuses this transition is valid
  // from; the caller's own pre-check is not race-safe on its own (findById then act is TOCTOU),
  // so this is the real guard. Returns null if the row's actual status had already moved on.
  static async setStatus(id, status, fromStatuses) {
    const result = await pool.query(
      `UPDATE job_requests SET status = $1 WHERE id = $2 AND status = ANY($3::job_status[]) RETURNING *`,
      [status, id, fromStatuses]
    );
    return result.rows[0] || null;
  }

  // Declines every other still-open (pending, mid-negotiation, or mid-handshake) request for
  // the same booking once one broker has won it. Includes 'awaiting_confirmation' — a sibling
  // parked mid-handshake must die too, otherwise it could still complete its own
  // second-confirm CAS after the fact (zombie state).
  static async declineOthersForBooking(bookingId, exceptJobRequestId) {
    await pool.query(
      `UPDATE job_requests SET status = 'declined' WHERE booking_id = $1 AND id != $2 AND status IN ('pending', 'countered', 'awaiting_confirmation')`,
      [bookingId, exceptJobRequestId]
    );
  }

  // Used when a booking is won through a different flow entirely (direct client-pick driver
  // negotiation, see driverRequest.controller.js's finalizeDriverRequest) — every job_requests
  // row ever broadcast for it, across every broker, is now moot. Unlike declineOthersForBooking,
  // there's no "winning" row on this table to except.
  static async declineAllForBooking(bookingId) {
    await pool.query(
      `UPDATE job_requests SET status = 'declined' WHERE booking_id = $1 AND status IN ('pending', 'countered', 'awaiting_confirmation')`,
      [bookingId]
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

  // Client proposes a new amount to one specific broker — either responding to that broker's
  // own counter ('countered'), or proactively renegotiating before the broker has replied at
  // all ('pending', e.g. tapping "Negotiate" on a still-open offer). Either way this leaves it
  // 'pending' — the broker owes a response either way, whether it's their first look at this
  // request or a reply to the client's new number.
  static async clientCounter(id, { amount, note }) {
    const entry = JSON.stringify([{ by: 'client', amount, note: note || null, at: new Date().toISOString() }]);
    const result = await pool.query(
      `UPDATE job_requests
       SET amount = $1, status = 'pending', offer_history = offer_history || $2::jsonb
       WHERE id = $3 AND status IN ('pending', 'countered')
       RETURNING *`,
      [amount, entry, id]
    );
    return result.rows[0] || null;
  }

  // Broker agrees at the current amount — mutual-confirmation, dual-purpose CAS mirroring
  // DriverRequestModel.respondentAccept. From 'pending': first side to commit — parks at
  // 'awaiting_confirmation' (pending_confirmation_by = 'broker'), nothing finalized yet. From
  // 'awaiting_confirmation' with pending_confirmation_by = 'client': the client already
  // committed, so this is the finalizing confirmation -> 'accepted'. Scoped to broker_id so a
  // broker can only accept their own row.
  static async brokerAccept(id, brokerId) {
    const result = await pool.query(
      `UPDATE job_requests SET
         status = CASE WHEN status = 'pending' THEN 'awaiting_confirmation' ELSE 'accepted' END,
         pending_confirmation_by = CASE WHEN status = 'pending' THEN 'broker' ELSE pending_confirmation_by END
       WHERE id = $1 AND broker_id = $2
         AND (status = 'pending' OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'client'))
       RETURNING *`,
      [id, brokerId]
    );
    return result.rows[0] || null;
  }

  // Client locks in a broker — same dual-purpose CAS, mirrored: from 'pending'/'countered' this
  // is the client committing first (parks at 'awaiting_confirmation', pending_confirmation_by
  // = 'client'); from 'awaiting_confirmation' with pending_confirmation_by = 'broker', this is
  // the client's finalizing confirmation of the broker's prior commitment -> 'accepted'.
  static async clientAcceptIfCountered(id) {
    const result = await pool.query(
      `UPDATE job_requests SET
         status = CASE WHEN status IN ('pending', 'countered') THEN 'awaiting_confirmation' ELSE 'accepted' END,
         pending_confirmation_by = CASE WHEN status IN ('pending', 'countered') THEN 'client' ELSE pending_confirmation_by END
       WHERE id = $1
         AND (status IN ('pending', 'countered') OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'broker'))
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Client rejects a broker's counter-offer (from 'countered'), or rejects a broker's prior
  // mutual-confirmation commitment (from 'awaiting_confirmation' with pending_confirmation_by
  // = 'broker') — atomic compare-and-swap either way.
  static async clientRejectIfCountered(id) {
    const result = await pool.query(
      `UPDATE job_requests
       SET status = 'declined'
       WHERE id = $1
         AND (status = 'countered' OR (status = 'awaiting_confirmation' AND pending_confirmation_by = 'broker'))
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Fixes the same bug as DriverRequestModel.rollbackAccepted: when finalizeJobRequest() fails
  // after this row was already flipped to 'accepted' (the booking was won by the other
  // negotiation path in the meantime), the caller must roll back by CAS-ing from the row's
  // actual current status ('accepted'), not blindly overwrite it.
  static async rollbackAccepted(id) {
    const result = await pool.query(
      `UPDATE job_requests SET status = 'declined' WHERE id = $1 AND status = 'accepted' RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

}

module.exports = JobRequestModel;
