const pool = require('../config/db');

class SavedAddressModel {
  static async findByClient(clientId) {
    const result = await pool.query(
      `SELECT * FROM saved_addresses WHERE client_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [clientId]
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM saved_addresses WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  // A first saved address becomes the default automatically — nothing else would ever set one
  // otherwise, and "no default among several saved addresses" isn't a useful state for
  // BookTruck.jsx to prefill from.
  static async create({ clientId, label, address, floor, lat, lng, city }) {
    const { rows: existing } = await pool.query(
      `SELECT COUNT(*) FROM saved_addresses WHERE client_id = $1`,
      [clientId]
    );
    const isDefault = parseInt(existing[0].count, 10) === 0;

    const result = await pool.query(
      `INSERT INTO saved_addresses (client_id, label, address, floor, lat, lng, city, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [clientId, label, address, floor || null, lat ?? null, lng ?? null, city || null, isDefault]
    );
    return result.rows[0];
  }

  static async update(id, clientId, fields) {
    const keys = Object.keys(fields).filter((key) => fields[key] !== undefined);
    if (!keys.length) return this.findById(id);

    const assignments = keys.map((key, index) => `${key} = $${index + 1}`);
    const values = keys.map((key) => fields[key]);
    const result = await pool.query(
      `UPDATE saved_addresses SET ${assignments.join(', ')}, updated_at = NOW()
       WHERE id = $${keys.length + 1} AND client_id = $${keys.length + 2}
       RETURNING *`,
      [...values, id, clientId]
    );
    return result.rows[0] || null;
  }

  // Only one default at a time — clear every other one for this client before setting this one,
  // in the same transaction so a crash mid-way never leaves two (or zero) defaults.
  static async setDefault(id, clientId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE saved_addresses SET is_default = FALSE, updated_at = NOW() WHERE client_id = $1`, [clientId]);
      const result = await client.query(
        `UPDATE saved_addresses SET is_default = TRUE, updated_at = NOW() WHERE id = $1 AND client_id = $2 RETURNING *`,
        [id, clientId]
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

  static async remove(id, clientId) {
    const result = await pool.query(
      `DELETE FROM saved_addresses WHERE id = $1 AND client_id = $2 RETURNING id, is_default`,
      [id, clientId]
    );
    const deleted = result.rows[0] || null;
    // Promote the most recently added remaining address to default so the client isn't left
    // with none, same reasoning as create()'s auto-default for the very first one.
    if (deleted?.is_default) {
      await pool.query(
        `UPDATE saved_addresses SET is_default = TRUE, updated_at = NOW()
         WHERE id = (SELECT id FROM saved_addresses WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1)`,
        [clientId]
      );
    }
    return !!deleted;
  }
}

module.exports = SavedAddressModel;
