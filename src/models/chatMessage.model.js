const pool = require('../config/db');

class ChatMessageModel {
  static async create({ threadId, senderId, message, meta }) {
    const result = await pool.query(
      `INSERT INTO chat_messages (thread_id, sender_id, message, meta)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [threadId, senderId, message, meta ? JSON.stringify(meta) : null]
    );
    return result.rows[0];
  }

  // Most recent page first (DESC) — same pagination shape as the rest of the app — but the
  // page itself is returned oldest-first (reversed) since that's how a chat UI renders it.
  static async findByThread(threadId, { page = 1, limit = 30 } = {}) {
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) FROM chat_messages WHERE thread_id = $1`, [threadId]);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `SELECT cm.*, u.name AS sender_name, u.role AS sender_role
       FROM chat_messages cm
       JOIN users u ON u.id = cm.sender_id
       WHERE cm.thread_id = $1
       ORDER BY cm.created_at DESC
       LIMIT $2 OFFSET $3`,
      [threadId, limit, offset]
    );

    return {
      messages: rows.rows.reverse(),
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  // Marks every message in the thread not sent by userId as read — called when a participant
  // opens/focuses the thread (REST PATCH .../read or the socket 'read' event). Returns how many
  // rows flipped so callers only broadcast a read-receipt when something actually changed.
  static async markThreadRead(threadId, userId) {
    const result = await pool.query(
      `UPDATE chat_messages SET read_at = NOW()
       WHERE thread_id = $1 AND sender_id != $2 AND read_at IS NULL
       RETURNING id`,
      [threadId, userId]
    );
    return result.rows.length;
  }

  // Total unread count across every thread this user participates in — booking threads
  // (client/broker/driver on the underlying booking) AND standing broker<->driver direct
  // threads (booking_id IS NULL, keyed on chat_threads.broker_id/driver_id instead — see
  // ChatThreadModel.findOrCreateDirect). Powers the header chat badge, same idea as
  // notifications.unread_count.
  //
  // The booking join here MUST be a LEFT JOIN, not an inner one: a direct thread has no
  // bookings row at all (ct.booking_id is NULL), so an inner join silently drops every direct
  // thread's messages from this count — the thread's own unread_count in ChatThreadModel.
  // listForUser still shows correctly in the chat list, just never surfaces in this badge.
  static async countUnreadForUser(userId) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM chat_messages cm
       JOIN chat_threads ct ON ct.id = cm.thread_id
       LEFT JOIN bookings b ON b.id = ct.booking_id
       WHERE cm.read_at IS NULL
         AND cm.sender_id != $1
         AND (
           $1 IN (b.client_id, b.broker_id, b.driver_id)
           OR (ct.booking_id IS NULL AND $1 IN (ct.broker_id, ct.driver_id))
         )`,
      [userId]
    );
    return parseInt(result.rows[0].count, 10);
  }
}

module.exports = ChatMessageModel;
