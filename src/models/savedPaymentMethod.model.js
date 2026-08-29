const pool = require('../config/db');

class SavedPaymentMethodModel {
  static async findByClient(clientId) {
    const result = await pool.query(
      `SELECT * FROM saved_payment_methods WHERE client_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [clientId]
    );
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM saved_payment_methods WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  static async create({ clientId, methodType, label, details }) {
    const { rows: existing } = await pool.query(
      `SELECT COUNT(*) FROM saved_payment_methods WHERE client_id = $1`,
      [clientId]
    );
    const isDefault = parseInt(existing[0].count, 10) === 0;

    const result = await pool.query(
      `INSERT INTO saved_payment_methods (client_id, method_type, label, details, is_default)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING *`,
      [clientId, methodType, label, JSON.stringify(details || {}), isDefault]
    );
    return result.rows[0];
  }

  static async setDefault(id, clientId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE saved_payment_methods SET is_default = FALSE WHERE client_id = $1`, [clientId]);
      const result = await client.query(
        `UPDATE saved_payment_methods SET is_default = TRUE WHERE id = $1 AND client_id = $2 RETURNING *`,
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
      `DELETE FROM saved_payment_methods WHERE id = $1 AND client_id = $2 RETURNING id, is_default`,
      [id, clientId]
    );
    const deleted = result.rows[0] || null;
    if (deleted?.is_default) {
      await pool.query(
        `UPDATE saved_payment_methods SET is_default = TRUE
         WHERE id = (SELECT id FROM saved_payment_methods WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1)`,
        [clientId]
      );
    }
    return !!deleted;
  }
}

module.exports = SavedPaymentMethodModel;
