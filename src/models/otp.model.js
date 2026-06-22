const pool = require('../config/db');

class OtpModel {
  // Create OTP
  static async create({ phone, otpCode, purpose = 'login', expiryMinutes = 10 }) {
    // Invalidate previous unused OTPs for same phone + purpose
    await pool.query(
      `UPDATE otps SET is_used = true WHERE phone = $1 AND purpose = $2 AND is_used = false`,
      [phone, purpose]
    );

    const result = await pool.query(
      `INSERT INTO otps (phone, otp_code, purpose, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '${expiryMinutes} minutes')
       RETURNING id, phone, purpose, expires_at, created_at`,
      [phone, otpCode, purpose]
    );
    return result.rows[0];
  }

  // Find valid OTP
  static async findValid({ phone, otpCode, purpose }) {
    const result = await pool.query(
      `SELECT * FROM otps
       WHERE phone = $1 AND otp_code = $2 AND purpose = $3
         AND is_used = false AND expires_at > NOW()
       ORDER BY created_at DESC
       LIMIT 1`,
      [phone, otpCode, purpose]
    );
    return result.rows[0] || null;
  }

  // Mark OTP used
  static async markUsed(id) {
    await pool.query(
      `UPDATE otps SET is_used = true WHERE id = $1`,
      [id]
    );
  }

  // Increment attempt
  static async incrementAttempt(phone, purpose) {
    await pool.query(
      `UPDATE otps SET attempts = attempts + 1
       WHERE phone = $1 AND purpose = $2 AND is_used = false
       ORDER BY created_at DESC`,
      [phone, purpose]
    );
  }

  // Count recent OTPs (rate limiting)
  static async countRecent(phone, purpose, minutes = 10) {
    const result = await pool.query(
      `SELECT COUNT(*) FROM otps
       WHERE phone = $1 AND purpose = $2
         AND created_at > NOW() - INTERVAL '${minutes} minutes'`,
      [phone, purpose]
    );
    return parseInt(result.rows[0].count);
  }
}

module.exports = OtpModel;
