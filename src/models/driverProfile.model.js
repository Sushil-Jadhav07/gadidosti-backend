const pool = require('../config/db');

// Aadhaar is stored in full but never returned in full — mask to the
// "XXXX-XXXX-1234" format the UI expects everywhere it's displayed.
const SELECT_WITH_JOINS = `
  SELECT dp.user_id, dp.broker_id, dp.license_no, dp.license_expiry,
         CASE WHEN dp.aadhaar IS NOT NULL THEN 'XXXX-XXXX-' || right(dp.aadhaar, 4) ELSE NULL END AS aadhaar,
         dp.truck_id, dp.total_trips, dp.avatar, dp.status, dp.created_at, dp.updated_at,
         u.name, u.phone, u.kyc_status,
         t.registration AS truck_reg
  FROM driver_profiles dp
  JOIN users u ON u.id = dp.user_id
  LEFT JOIN trucks t ON t.id = dp.truck_id
`;

class DriverProfileModel {
  static async create({ userId, brokerId, licenseNo, licenseExpiry, aadhaar, truckId, avatar }) {
    const result = await pool.query(
      `INSERT INTO driver_profiles (user_id, broker_id, license_no, license_expiry, aadhaar, truck_id, avatar)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING user_id`,
      [userId, brokerId, licenseNo || null, licenseExpiry || null, aadhaar || null, truckId || null, avatar || null]
    );
    return this.findById(result.rows[0].user_id);
  }

  static async findById(userId) {
    const result = await pool.query(`${SELECT_WITH_JOINS} WHERE dp.user_id = $1`, [userId]);
    return result.rows[0] || null;
  }

  static async exists(userId) {
    const result = await pool.query(`SELECT 1 FROM driver_profiles WHERE user_id = $1`, [userId]);
    return result.rowCount > 0;
  }

  static async findAll({ role, brokerId, status, page = 1, limit = 10 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (role === 'broker') {
      conditions.push(`dp.broker_id = $${idx++}`);
      params.push(brokerId);
    }
    if (status) {
      conditions.push(`dp.status = $${idx++}`);
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM driver_profiles dp ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const rows = await pool.query(
      `${SELECT_WITH_JOINS} ${where} ORDER BY dp.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      drivers: rows.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / limit) || 0,
    };
  }

  static async update(userId, { licenseNo, licenseExpiry, aadhaar, truckId, avatar, status }) {
    const result = await pool.query(
      `UPDATE driver_profiles SET
         license_no = COALESCE($1, license_no),
         license_expiry = COALESCE($2, license_expiry),
         aadhaar = COALESCE($3, aadhaar),
         truck_id = COALESCE($4, truck_id),
         avatar = COALESCE($5, avatar),
         status = COALESCE($6, status),
         updated_at = NOW()
       WHERE user_id = $7
       RETURNING user_id`,
      [licenseNo, licenseExpiry, aadhaar, truckId, avatar, status, userId]
    );
    if (!result.rows[0]) return null;
    return this.findById(userId);
  }

  static async incrementTotalTrips(userId) {
    await pool.query(`UPDATE driver_profiles SET total_trips = total_trips + 1, updated_at = NOW() WHERE user_id = $1`, [userId]);
  }
}

module.exports = DriverProfileModel;
