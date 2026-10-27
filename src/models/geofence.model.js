const pool = require('../config/db');

class GeofenceModel {
  static async list() {
    const result = await pool.query(`SELECT * FROM allowed_pincodes ORDER BY created_at DESC`);
    return result.rows;
  }

  static async create({ pincode, label }) {
    const result = await pool.query(
      `INSERT INTO allowed_pincodes (pincode, label) VALUES ($1, $2) RETURNING *`,
      [pincode, label || null]
    );
    return result.rows[0];
  }

  static async setActive(id, active) {
    const result = await pool.query(
      `UPDATE allowed_pincodes SET active = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [active, id]
    );
    return result.rows[0] || null;
  }

  static async remove(id) {
    const result = await pool.query(`DELETE FROM allowed_pincodes WHERE id = $1 RETURNING id`, [id]);
    return result.rowCount > 0;
  }

  // An empty/all-inactive whitelist means "no restriction configured yet" — fail-open so a fresh
  // deploy doesn't instantly block every booking before an admin populates the list.
  static async isAnyConfigured() {
    const result = await pool.query(`SELECT 1 FROM allowed_pincodes WHERE active = true LIMIT 1`);
    return result.rowCount > 0;
  }

  static async isAllowed(pincode) {
    if (!pincode) return false;
    const result = await pool.query(
      `SELECT 1 FROM allowed_pincodes WHERE pincode = $1 AND active = true LIMIT 1`,
      [pincode]
    );
    return result.rowCount > 0;
  }
}

module.exports = GeofenceModel;
