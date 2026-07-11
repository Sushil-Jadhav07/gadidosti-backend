const pool = require('../config/db');

class IdempotencyKeyModel {
  static async find(key, userId, endpoint) {
    const result = await pool.query(
      `SELECT response_snapshot FROM idempotency_keys WHERE idempotency_key = $1 AND user_id = $2 AND endpoint = $3`,
      [key, userId, endpoint]
    );
    return result.rows[0] ? result.rows[0].response_snapshot : null;
  }

  // Races on the same key are resolved by the unique index — a losing concurrent insert
  // hits ON CONFLICT DO NOTHING and the caller just replays the winner's snapshot on retry.
  static async save(key, userId, endpoint, responseSnapshot) {
    await pool.query(
      `INSERT INTO idempotency_keys (idempotency_key, user_id, endpoint, response_snapshot)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (idempotency_key, user_id, endpoint) DO NOTHING`,
      [key, userId, endpoint, JSON.stringify(responseSnapshot)]
    );
  }
}

module.exports = IdempotencyKeyModel;
