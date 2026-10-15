const pool = require('../config/db');

class LegalPageModel {
  // Admin list — every row (or scoped to one audience), newest-edited first within each group
  // isn't meaningful here (there are only ever 18 rows total, one per audience x page_key), so
  // this just orders predictably for a stable table: audience, then page_key.
  static async findAll({ audience } = {}) {
    if (audience) {
      const result = await pool.query(
        `SELECT * FROM legal_pages WHERE audience = $1 ORDER BY page_key`,
        [audience]
      );
      return result.rows;
    }
    const result = await pool.query(`SELECT * FROM legal_pages ORDER BY audience, page_key`);
    return result.rows;
  }

  static async findById(id) {
    const result = await pool.query(`SELECT * FROM legal_pages WHERE id = $1`, [id]);
    return result.rows[0] || null;
  }

  // Public read — audience + page_key together are the page's real identity (see the UNIQUE
  // constraint), not id, since no public caller ever knows a row's UUID.
  static async findByAudienceAndKey(audience, pageKey) {
    const result = await pool.query(
      `SELECT * FROM legal_pages WHERE audience = $1 AND page_key = $2`,
      [audience, pageKey]
    );
    return result.rows[0] || null;
  }

  static async update(id, { title, content, updatedBy }) {
    const result = await pool.query(
      `UPDATE legal_pages SET
         title = COALESCE($1, title),
         content = COALESCE($2, content),
         updated_by = COALESCE($3, updated_by),
         updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [title, content, updatedBy, id]
    );
    return result.rows[0] || null;
  }
}

module.exports = LegalPageModel;
