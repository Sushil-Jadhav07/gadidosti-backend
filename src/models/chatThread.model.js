const pool = require('../config/db');

class ChatThreadModel {
  // Get-or-create — one thread per booking, created lazily on first access. The ON CONFLICT
  // branch makes this atomic: two participants opening the chat at the same instant can't both
  // insert and violate the UNIQUE(booking_id) constraint. `created` distinguishes a real insert
  // from the conflict/no-op branch via the `xmax = 0` trick (0 means this row was inserted by
  // this statement; non-zero means it already existed and this was the ON CONFLICT branch) —
  // chatService uses it to seed the bot's greeting message exactly once, not on every open.
  static async findOrCreateByBooking(bookingId) {
    const existing = await pool.query(`SELECT * FROM chat_threads WHERE booking_id = $1`, [bookingId]);
    if (existing.rows[0]) return { thread: existing.rows[0], created: false };

    const result = await pool.query(
      `INSERT INTO chat_threads (booking_id) VALUES ($1)
       ON CONFLICT (booking_id) DO UPDATE SET booking_id = EXCLUDED.booking_id
       RETURNING *, (xmax = 0) AS created`,
      [bookingId]
    );
    const { created, ...thread } = result.rows[0];
    return { thread, created };
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM chat_threads WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  // 'bot' -> 'human' on escalation, never reverts. Guarded on the current value so a
  // double-fired escalation (race, double-tap) only triggers its caller's side effects
  // (notifying the driver/broker) once — returns null on a no-op.
  static async setStage(threadId, stage) {
    const result = await pool.query(
      `UPDATE chat_threads SET stage = $2 WHERE id = $1 AND stage != $2 RETURNING *`,
      [threadId, stage]
    );
    return result.rows[0] || null;
  }

  // Every thread the user participates in (client/broker/driver, via the underlying booking) —
  // or every thread at all, for admin — with enough denormalized info to render a chat list
  // without N+1 calls: booking summary, all three participant names (the frontend picks which
  // is "the other party" based on its own role), the last message preview, and this viewer's
  // own unread count. Powers GET /api/chat/threads for every dashboard's chat-list screen.
  static async listForUser(user) {
    const result = await pool.query(
      `SELECT
         ct.id AS thread_id, ct.booking_id, ct.stage, ct.created_at AS thread_created_at,
         b.booking_number, b.status AS booking_status, b.pickup_location, b.drop_location,
         b.client_id, b.broker_id, b.driver_id,
         cu.name AS client_name, bu.name AS broker_name, du.name AS driver_name,
         lm.message AS last_message, lm.created_at AS last_message_at,
         lm.sender_id AS last_sender_id, lm.sender_role AS last_sender_role,
         COALESCE(uc.unread_count, 0)::int AS unread_count
       FROM chat_threads ct
       JOIN bookings b ON b.id = ct.booking_id
       LEFT JOIN users cu ON cu.id = b.client_id
       LEFT JOIN users bu ON bu.id = b.broker_id
       LEFT JOIN users du ON du.id = b.driver_id
       LEFT JOIN LATERAL (
         SELECT cm.message, cm.created_at, cm.sender_id, su.role AS sender_role
         FROM chat_messages cm
         JOIN users su ON su.id = cm.sender_id
         WHERE cm.thread_id = ct.id
         ORDER BY cm.created_at DESC
         LIMIT 1
       ) lm ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS unread_count
         FROM chat_messages cm2
         WHERE cm2.thread_id = ct.id AND cm2.read_at IS NULL AND cm2.sender_id != $1
       ) uc ON true
       WHERE $2 = 'admin' OR $1 IN (b.client_id, b.broker_id, b.driver_id)
       ORDER BY COALESCE(lm.created_at, ct.created_at) DESC
       LIMIT 100`,
      [user.id, user.role]
    );
    return result.rows;
  }
}

module.exports = ChatThreadModel;
