const pool = require('../config/db');

class BrokerProfileModel {
  // Upsert-on-first-touch: unlike driver_profiles, a broker_profiles row isn't created
  // at registration/KYC time, so any read/update needs to lazily create it first.
  static async ensure(userId) {
    const inserted = await pool.query(
      `INSERT INTO broker_profiles (user_id) VALUES ($1)
       ON CONFLICT (user_id) DO NOTHING
       RETURNING user_id, service_city, is_online, created_at, updated_at`,
      [userId]
    );
    if (inserted.rows[0]) return inserted.rows[0];
    return this.findByUserId(userId);
  }

  static async findByUserId(userId) {
    const result = await pool.query(
      `SELECT user_id, service_city, is_online, created_at, updated_at FROM broker_profiles WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  static async setServiceCity(userId, serviceCity) {
    await this.ensure(userId);
    const result = await pool.query(
      `UPDATE broker_profiles SET service_city = $1, updated_at = NOW() WHERE user_id = $2
       RETURNING user_id, service_city, is_online, created_at, updated_at`,
      [serviceCity, userId]
    );
    return result.rows[0];
  }

  static async setOnline(userId, isOnline) {
    await this.ensure(userId);
    const result = await pool.query(
      `UPDATE broker_profiles SET is_online = $1, updated_at = NOW() WHERE user_id = $2
       RETURNING user_id, service_city, is_online, created_at, updated_at`,
      [isOnline, userId]
    );
    return result.rows[0];
  }

  // Brokers eligible for a new booking's job-request broadcast: KYC-verified, active,
  // online, and (when a city is given) matching service_city. LEFT JOIN so a broker who
  // has never touched their profile (no row yet) still matches — COALESCE preserves the
  // is_online column's TRUE default for that case.
  static async findEligibleBrokers({ city } = {}) {
    const conditions = [
      `u.role = 'broker'`,
      `u.status = 'active'`,
      `u.kyc_status = 'verified'`,
      `COALESCE(bp.is_online, TRUE) = TRUE`,
    ];
    const params = [];

    if (city) {
      conditions.push(`bp.service_city = $1`);
      params.push(city);
    }

    const result = await pool.query(
      `SELECT u.id FROM users u LEFT JOIN broker_profiles bp ON bp.user_id = u.id WHERE ${conditions.join(' AND ')}`,
      params
    );
    return result.rows.map((row) => row.id);
  }
}

module.exports = BrokerProfileModel;
