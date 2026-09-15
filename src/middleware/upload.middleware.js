const multer = require('multer');

// Memory storage — the buffer is handed to the active StorageProvider (src/providers/storage),
// which decides where it actually ends up. Matches express.json's 10mb body limit (app.js).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Dedicated instance for proof-of-delivery uploads (POST /api/trips/:id/pod) — photos AND now
// video, per the confirmed feature. Deliberately a SEPARATE multer instance from the shared
// `upload` above (which stays untouched at its original 10MB/no-filter config for KYC document
// uploads) rather than raising that shared limit globally, since a video is routinely far
// larger than any other file this app ever accepts. 50MB is a judgment call — comfortably fits
// a short phone-camera clip without inviting an unbounded upload; the active StorageProvider
// (src/providers/storage) still ultimately decides where the buffer lands, and the Postgres
// provider in particular has no business storing much larger blobs than this in a bytea column.
// No MIME whitelist existed at all before this — anything was accepted as "proof" — so this is
// also the first real validation here: image/* or video/* only.
const podUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^(image|video)\//.test(file.mimetype)) return cb(null, true);
    cb(new Error('Only image or video files are allowed as proof of delivery'));
  },
});

module.exports = upload;
module.exports.podUpload = podUpload;
