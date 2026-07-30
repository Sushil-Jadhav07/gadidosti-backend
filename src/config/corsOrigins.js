// Local dev origins are always allowed in addition to whatever ALLOWED_ORIGINS
// lists — so a Vite/React frontend running locally (e.g. the admin dashboard)
// can call this API, including the deployed instance, without editing
// production env vars every time a new local dev port needs access.
const localDevOrigins = ['http://localhost:5173', 'http://localhost:3000'];

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

module.exports = configuredOrigins ? [...configuredOrigins, ...localDevOrigins] : '*';
