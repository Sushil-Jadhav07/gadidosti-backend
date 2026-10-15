const pool = require('../config/db');

class AccountDeletionRequestModel {
  static async create({ audience, name, email, phone, reason }) {
    const result = await pool.query(
      `INSERT INTO account_deletion_requests (audience, name, email, phone, reason)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [audience, name || null, email || null, phone || null, reason || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM account_deletion_requests WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findAll({ status, audience, page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (audience) {
      conditions.push(`audience = $${idx++}`);
      params.push(audience);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) FROM account_deletion_requests ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `SELECT * FROM account_deletion_requests ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return { requests: rows.rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10), total_pages: Math.ceil(total / limit) || 0 };
  }

  // Status/notes only — never touches any other table. The admin reviewing this still has to go
  // delete/anonymize the actual account themselves (existing user-management tooling); this is
  // deliberately just a record of the request and how it was resolved, not an action trigger.
  static async updateStatus(id, { status, adminNotes, processedBy }) {
    const result = await pool.query(
      `UPDATE account_deletion_requests SET
         status = COALESCE($1, status),
         admin_notes = COALESCE($2, admin_notes),
         processed_by = COALESCE($3, processed_by),
         processed_at = CASE WHEN $1 IS NOT NULL AND $1 != 'pending' THEN NOW() ELSE processed_at END,
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, adminNotes, processedBy, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = AccountDeletionRequestModel;
