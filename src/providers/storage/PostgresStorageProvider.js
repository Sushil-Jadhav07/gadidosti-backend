const pool = require('../../config/db');
const StorageProvider = require('./StorageProvider');

// Stores the file bytes directly in a table (kyc_files or pod_files) instead of local
// disk or a third-party bucket — survives Render's ephemeral filesystem without needing
// a separate cloud storage account. Files are served back out via a dedicated GET route
// (kyc.controller.js / trip.controller.js), not a static URL.
class PostgresStorageProvider extends StorageProvider {
  // resource defaults to 'kyc' so existing callers (kyc.controller.js) are unaffected;
  // pass resource: 'pod', resourceId: tripId to store a proof-of-delivery photo instead.
  async upload({ buffer, filename, folder = '', mimeType = 'application/octet-stream', documentKey = '', resource = 'kyc', resourceId = null }) {
    if (resource === 'pod') {
      const { rows } = await pool.query(
        `INSERT INTO pod_files (trip_id, filename, mime_type, data)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [resourceId, filename, mimeType, buffer]
      );
      return { url: `/api/trips/pod/file/${rows[0].id}` };
    }

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
