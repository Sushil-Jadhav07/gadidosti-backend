const pool = require('../config/db');

class RefreshTokenModel {
  // Store refresh token
  static async create({ userId, tokenHash, userAgent, ipAddress, expiryDays = 30 }) {
    const result = await pool.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '${expiryDays} days')
       RETURNING id, user_id, expires_at, created_at`,
      [userId, tokenHash, userAgent || null, ipAddress || null]
    );
    return result.rows[0];
  }

  // Find valid token
  static async findValid(tokenHash) {
    const result = await pool.query(
      `SELECT rt.*, u.id as uid, u.role, u.status
       FROM refresh_tokens rt
       JOIN users u ON rt.user_id = u.id
       WHERE rt.token_hash = $1
         AND rt.is_revoked = false
         AND rt.expires_at > NOW()`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  // Revoke one token
  static async revoke(tokenHash) {
    await pool.query(
      `UPDATE refresh_tokens SET is_revoked = true WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  // Revoke all tokens for a user (logout all devices)
  static async revokeAllForUser(userId) {
    await pool.query(
      `UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1`,
      [userId]
    );
  }
}

module.exports = RefreshTokenModel;
