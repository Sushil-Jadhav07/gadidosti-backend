const pool = require('../config/db');

class UserModel {
  // Create admin user (active + verified immediately, no OTP needed)
  static async createAdmin({ name, email, phone, passwordHash }) {
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, status, is_phone_verified, is_email_verified)
       VALUES ($1, $2, $3, $4, 'admin', 'active', true, true)
       RETURNING id, name, email, phone, role, status, is_phone_verified, is_email_verified, created_at`,
      [name, email || null, phone, passwordHash]
    );
    return result.rows[0];
  }

  // Create new user
  static async create({ name, email, phone, passwordHash, role = 'client' }) {
    const result = await pool.query(
      `INSERT INTO users (name, email, phone, password_hash, role, status)
       VALUES ($1, $2, $3, $4, $5, 'pending_verification')
       RETURNING id, name, email, phone, role, status, is_phone_verified, is_email_verified, created_at`,
      [name, email || null, phone, passwordHash, role]
    );
    return result.rows[0];
  }

  // Find by ID
  static async findById(id) {
    const result = await pool.query(
      `SELECT id, name, email, phone, role, status, is_phone_verified, is_email_verified,
              profile_image, last_login_at, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  // Find by phone (includes password hash for auth)
  static async findByPhone(phone) {
    const result = await pool.query(
      `SELECT id, name, email, phone, password_hash, role, status,
              is_phone_verified, is_email_verified, last_login_at
       FROM users WHERE phone = $1`,
      [phone]
    );
    return result.rows[0] || null;
  }

  // Find by email
  static async findByEmail(email) {
    const result = await pool.query(
      `SELECT id, name, email, phone, password_hash, role, status,
              is_phone_verified, is_email_verified, last_login_at
       FROM users WHERE email = $1`,
      [email]
    );
    return result.rows[0] || null;
  }

  // Update last login
  static async updateLastLogin(id) {
    await pool.query(
      `UPDATE users SET last_login_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  // Verify phone
  static async verifyPhone(phone) {
    const result = await pool.query(
      `UPDATE users SET is_phone_verified = true, status = 'active', updated_at = NOW()
       WHERE phone = $1
       RETURNING id, name, email, phone, role, status, is_phone_verified`,
      [phone]
    );
    return result.rows[0] || null;
  }

  // Update profile
  static async updateProfile(id, { name, email, profileImage }) {
    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           email = COALESCE($2, email),
           profile_image = COALESCE($3, profile_image),
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, name, email, phone, role, status, is_phone_verified, is_email_verified, profile_image, updated_at`,
      [name, email, profileImage, id]
    );
    return result.rows[0] || null;
  }

  // Update password
  static async updatePassword(id, passwordHash) {
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [passwordHash, id]
    );
  }

  // Update status (admin)
  static async updateStatus(id, status) {
    const result = await pool.query(
      `UPDATE users SET status = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, email, phone, role, status, updated_at`,
      [status, id]
    );
    return result.rows[0] || null;
  }

  // Soft delete (admin)
  static async delete(id) {
    await pool.query(
      `UPDATE users SET status = 'inactive', updated_at = NOW() WHERE id = $1`,
      [id]
    );
  }

  // List users with filters + pagination (admin)
  static async findAll({ role, status, search, page = 1, limit = 10 }) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role) {
      conditions.push(`role = $${idx++}`);
      params.push(role);
    }
    if (status) {
      conditions.push(`status = $${idx++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(name ILIKE $${idx} OR email ILIKE $${idx} OR phone ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM users ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    const usersResult = await pool.query(
      `SELECT id, name, email, phone, role, status, is_phone_verified, is_email_verified,
              profile_image, last_login_at, created_at, updated_at
       FROM users ${where}
       ORDER BY created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      users: usersResult.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit),
    };
  }
}

module.exports = UserModel;
