// Turns a relative path (e.g. "/api/kyc/documents/file/<id>" from PostgresStorageProvider,
// or "/uploads/kyc/<userId>/<file>" from FakeLocalStorageProvider) into an absolute URL.
// Prefers API_BASE_URL (set this in production — e.g. https://gadidosti-backend.onrender.com)
// so links are stable regardless of which host actually served the request; falls back to
// the request's own protocol+host for local/dev use when the env var isn't set.
const toAbsoluteUrl = (req, relativePath) => {
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const base = (process.env.API_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}${relativePath}`;
};

// Builds the absolute URL for a Postgres-stored KYC file by its kyc_files.id.
const getFileUrl = (req, fileId) => toAbsoluteUrl(req, `/api/kyc/documents/file/${fileId}`);

module.exports = { getFileUrl, toAbsoluteUrl };
