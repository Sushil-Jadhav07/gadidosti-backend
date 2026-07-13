const pool = require('../../config/db');
const StorageProvider = require('./StorageProvider');

// Stores the file bytes directly in the kyc_files table instead of local disk
// or a third-party bucket — survives Render's ephemeral filesystem without
// needing a separate cloud storage account. Files are served back out via
// GET /api/kyc/documents/file/:id (kyc.controller.js), not a static URL.
class PostgresStorageProvider extends StorageProvider {
  async upload({ buffer, filename, folder = '', mimeType = 'application/octet-stream', documentKey = '' }) {
    const userId = folder.split('/')[1] || null;

    const { rows } = await pool.query(
      `INSERT INTO kyc_files (user_id, document_key, filename, mime_type, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [userId, documentKey, filename, mimeType, buffer]
    );

    return { url: `/api/kyc/documents/file/${rows[0].id}` };
  }
}

module.exports = PostgresStorageProvider;
