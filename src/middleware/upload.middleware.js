const multer = require('multer');

// Memory storage — the buffer is handed to the active StorageProvider (src/providers/storage),
// which decides where it actually ends up. Matches express.json's 10mb body limit (app.js).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = upload;
