const pool = require('../config/db');

class ChatThreadModel {
  // Get-or-create — one thread per booking, created lazily on first access. The ON CONFLICT
  // branch makes this atomic: two participants opening the chat at the same instant can't
  // both insert and violate the UNIQUE(booking_id) constraint.
  static async findOrCreateByBooking(bookingId) {
    const existing = await pool.query(`SELECT * FROM chat_threads WHERE booking_id = $1`, [bookingId]);
    if (existing.rows[0]) return existing.rows[0];

    const result = await pool.query(
      `INSERT INTO chat_threads (booking_id) VALUES ($1)
       ON CONFLICT (booking_id) DO UPDATE SET booking_id = EXCLUDED.booking_id
       RETURNING *`,
      [bookingId]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM chat_threads WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }
}

module.exports = ChatThreadModel;
