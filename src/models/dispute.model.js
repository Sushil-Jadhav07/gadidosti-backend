const pool = require('../config/db');

const SELECT_WITH_JOINS = `
  SELECT d.*, u.name AS raised_by_name, b.booking_number
  FROM disputes d
  JOIN users u ON u.id = d.raised_by_user_id
  JOIN bookings b ON b.id = d.booking_id
`;

class DisputeModel {
  static async create({ bookingId, raisedByUserId, raisedByRole, issueType, description }) {
    const result = await pool.query(
      `INSERT INTO disputes (booking_id, raised_by_user_id, raised_by_role, issue_type, description)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [bookingId, raisedByUserId, raisedByRole, issueType, description]
    );
    return result.rows[0];
  }

  static async findById(id) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE d.id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async findAll({ scopeUserId, status, issueType, page = 1, limit = 10 } = {}) {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (scopeUserId) {
      conditions.push(`d.raised_by_user_id = $${idx++}`);
      params.push(scopeUserId);
    }
    if (status) {
      conditions.push(`d.status = $${idx++}`);
      params.push(status);
    }
    if (issueType) {
      conditions.push(`d.issue_type = $${idx++}`);
      params.push(issueType);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (page - 1) * limit;

    const countResult = await pool.query(`SELECT COUNT(*) FROM disputes d ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY d.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      disputes: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async resolve(id, resolution) {
    const result = await pool.query(
      `UPDATE disputes SET status = 'resolved', resolution = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [resolution, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = DisputeModel;
