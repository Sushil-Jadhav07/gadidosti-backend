const pool = require('../config/db');

class KycModel {
  // Create or overwrite a user's KYC submission — resets it back to 'pending' review
  static async upsertSubmission(userId, documents) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO kyc_submissions (user_id, documents, submitted_at, updated_at)
         VALUES ($1, $2, NOW(), NOW())
         ON CONFLICT (user_id) DO UPDATE
           SET documents = $2,
               rejection_reason = NULL,
               reviewed_by = NULL,
               reviewed_at = NULL,
               submitted_at = NOW(),
               updated_at = NOW()
         RETURNING id, user_id, documents, rejection_reason, reviewed_at, submitted_at, updated_at`,
        [userId, JSON.stringify(documents)]
      );

      await client.query(`UPDATE users SET kyc_status = 'pending', updated_at = NOW() WHERE id = $1`, [userId]);

      await client.query('COMMIT');
      return result.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Fetch a single user's own submission
  static async findByUserId(userId) {
    const result = await pool.query(
      `SELECT id, user_id, documents, rejection_reason, reviewed_at, submitted_at, updated_at
       FROM kyc_submissions WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  // Admin: list submissions joined with user info, filterable + paginated
  static async findAll({ kycStatus, role, search, page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (kycStatus) {
      conditions.push(`u.kyc_status = $${idx++}`);
      params.push(kycStatus);
    }
    if (role) {
      conditions.push(`u.role = $${idx++}`);
      params.push(role);
    } else {
      conditions.push(`u.role IN ('broker', 'driver')`);
    }
    if (search) {
      conditions.push(`(u.name ILIKE $${idx} OR u.email ILIKE $${idx} OR u.phone ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM users u ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `SELECT u.id AS user_id, u.name, u.email, u.phone, u.role, u.kyc_status, u.created_at AS registered_at,
              k.documents, k.rejection_reason, k.reviewed_at, k.submitted_at
       FROM users u
       LEFT JOIN kyc_submissions k ON k.user_id = u.id
       ${where}
       ORDER BY
         CASE u.kyc_status WHEN 'pending' THEN 0 WHEN 'not_submitted' THEN 1 WHEN 'rejected' THEN 2 ELSE 3 END,
         u.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      submissions: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  // Admin: approve or reject a user's KYC
  static async review(userId, { status, reviewerId, reason }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      await client.query(`UPDATE users SET kyc_status = $1, updated_at = NOW() WHERE id = $2`, [status, userId]);

      const result = await client.query(
        `UPDATE kyc_submissions
         SET rejection_reason = $1, reviewed_by = $2, reviewed_at = NOW(), updated_at = NOW()
         WHERE user_id = $3
         RETURNING id, user_id, documents, rejection_reason, reviewed_at, submitted_at, updated_at`,
        [status === 'rejected' ? (reason || null) : null, reviewerId, userId]
      );

      await client.query('COMMIT');
      return result.rows[0] || null;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = KycModel;
