const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const StorageProvider = require('./StorageProvider');

// Saves under backend/uploads/{folder}/{filename}, served back out via
// express.static('/uploads') (see app.js). Returns a path relative to the API's
// own origin — callers needing an absolute URL should prepend their public base URL.
//
// NOT safe for production on platforms with an ephemeral filesystem (e.g. Render) —
// every uploaded file is lost on the next deploy/restart. This is local dev/testing
// only, until a real cloud storage provider (S3/Cloudinary) is wired up behind
// STORAGE_PROVIDER.
const UPLOADS_ROOT = path.join(__dirname, '..', '..', '..', 'uploads');

class FakeLocalStorageProvider extends StorageProvider {
  async upload({ buffer, filename, folder = '' }) {
    const dir = path.join(UPLOADS_ROOT, folder);
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(filename || '') || '';
    const safeName = `${Date.now()}-${uuidv4().slice(0, 8)}${ext}`;
    fs.writeFileSync(path.join(dir, safeName), buffer);

    const url = path.posix.join('/uploads', folder, safeName);
    return { url };
  }
}

module.exports = FakeLocalStorageProvider;
