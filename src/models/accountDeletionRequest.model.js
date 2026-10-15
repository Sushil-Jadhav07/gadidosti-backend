const pool = require('../config/db');

// Joins in the linked account's current name/status (not the request's own free-text
// name/email/phone snapshot) so the admin screen can show whether it's still a real, active
// account before offering to delete it — a request submitted days ago could target an account
// that's since been blocked/deleted some other way, which the raw request row alone can't show.
const SELECT_WITH_USER = `
  SELECT adr.*, u.name AS linked_user_name, u.email AS linked_user_email,
         u.phone AS linked_user_phone, u.status AS linked_user_status, u.role AS linked_user_role
  FROM account_deletion_requests adr
  LEFT JOIN users u ON u.id = adr.user_id
`;

class AccountDeletionRequestModel {
  // userId is set only for a request submitted by a logged-in user (see the authenticated
  // submit endpoint) — null for the public/logged-out legal-page form, same as before.
  static async create({ audience, name, email, phone, reason, userId }) {
    const result = await pool.query(
      `INSERT INTO account_deletion_requests (audience, name, email, phone, reason, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [audience, name || null, email || null, phone || null, reason || null, userId || null]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_USER} WHERE adr.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findAll({ status, audience, page = 1, limit = 20 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (status) {
      conditions.push(`adr.status = $${idx++}`);
      params.push(status);
    }
    if (audience) {
      conditions.push(`adr.audience = $${idx++}`);
      params.push(audience);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) FROM account_deletion_requests adr ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `${SELECT_WITH_USER} ${where} ORDER BY adr.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return { requests: rows.rows, total, page: parseInt(page, 10), limit: parseInt(limit, 10), total_pages: Math.ceil(total / limit) || 0 };
  }

  // Status/notes only — never touches the users table. Used for "Reject" and for plain note-
  // taking on a request with no linked account (nothing to actually delete). Actually deleting
  // the linked account is a separate action — see accountDeletionRequest.controller's
  // deleteAccountFromRequest, which calls UserModel.delete then this same update.
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
