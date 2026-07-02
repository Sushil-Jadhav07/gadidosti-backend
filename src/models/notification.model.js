const pool = require('../config/db');

class NotificationModel {
  // Create a notification for a user (used internally by other modules — bookings, payments, etc.)
  static async create({ userId, title, message, type = 'general', meta }) {
    const result = await pool.query(
      `INSERT INTO notifications (user_id, title, message, type, meta)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, title, message, type, is_read, meta, created_at`,
      [userId, title, message, type, meta ? JSON.stringify(meta) : null]
    );
    return result.rows[0];
  }

  // List a user's notifications, paginated, with total + unread counts
  static async findByUser(userId, { page = 1, limit = 20 } = {}) {
    const offset = (page - 1) * limit;

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_read = false) AS unread
       FROM notifications WHERE user_id = $1`,
      [userId]
    );
    const total = parseInt(countResult.rows[0].total);
    const unread = parseInt(countResult.rows[0].unread);

    const result = await pool.query(
      `SELECT id, title, message, type, is_read, meta, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    return {
      notifications: result.rows,
      total,
      unread_count: unread,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  // Mark a single notification read — scoped to the owning user
  static async markRead(id, userId) {
    const result = await pool.query(
      `UPDATE notifications SET is_read = true
       WHERE id = $1 AND user_id = $2
       RETURNING id, title, message, type, is_read, meta, created_at`,
      [id, userId]
    );
    return result.rows[0] || null;
  }

  // Mark every unread notification for a user as read; returns count updated
  static async markAllRead(userId) {
    const result = await pool.query(
      `UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false`,
      [userId]
    );
    return result.rowCount;
  }
}

module.exports = NotificationModel;
