const pool = require('../config/db');

class GeofenceModel {
  // Paginated + searchable — the whitelist can now run into the thousands via bulk upload, so
  // the admin page can no longer just render every row at once. `search` matches either the
  // pincode itself or its label (case-insensitive substring), same ILIKE pattern used elsewhere
  // in this codebase (e.g. KycModel.findAll).
  static async list({ search, page = 1, limit = 25 } = {}) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params = [];
    let idx = 1;

    if (search) {
      conditions.push(`(pincode ILIKE $${idx} OR label ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countResult = await pool.query(`SELECT COUNT(*) FROM allowed_pincodes ${where}`, params);
    const total = parseInt(countResult.rows[0].count, 10);

    const rows = await pool.query(
      `SELECT * FROM allowed_pincodes ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    );

    return {
      pincodes: rows.rows,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      total_pages: Math.ceil(total / limit) || 0,
    };
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

  // Bulk import (see geofence.controller.js's bulkUploadPincodes) — one multi-row INSERT rather
  // than a query per row. ON CONFLICT upserts the label instead of erroring, so re-uploading the
  // same sheet (or one with overlapping pincodes) is safe to repeat. `xmax = 0` is Postgres' own
  // tell for "this row was actually inserted" vs "this hit the ON CONFLICT UPDATE branch" —
  // lets the caller report accurate added/updated counts instead of just a total.
  static async bulkCreate(rows) {
    if (!rows.length) return [];
    const values = [];
    const placeholders = rows.map((row, i) => {
      values.push(row.pincode, row.label || null);
      return `($${i * 2 + 1}, $${i * 2 + 2})`;
    });
    const result = await pool.query(
      `INSERT INTO allowed_pincodes (pincode, label) VALUES ${placeholders.join(', ')}
       ON CONFLICT (pincode) DO UPDATE SET label = COALESCE(EXCLUDED.label, allowed_pincodes.label), updated_at = NOW()
       RETURNING pincode, (xmax = 0) AS inserted`,
      values
    );
    return result.rows;
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
