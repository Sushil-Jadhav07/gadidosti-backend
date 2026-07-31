// Local dev origins are always allowed in addition to whatever ALLOWED_ORIGINS
// lists — matched by pattern (any port) rather than a fixed list, since Vite
// bumps to the next free port (5173, 5174, 5175...) whenever the default is
// taken, and a hardcoded port breaks CORS again every time that happens.
const localDevOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

const configuredOrigins = process.env.ALLOWED_ORIGINS
  ?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// No ALLOWED_ORIGINS configured → allow everything (previous '*' behavior).
// Otherwise allow the configured list plus any localhost port.
// Exported as an `(origin, callback)` function, which both the `cors`
// middleware and socket.io accept directly as their `origin` option.
module.exports = (origin, callback) => {
  if (!configuredOrigins) return callback(null, true);
  if (!origin) return callback(null, true); // non-browser requests (curl, server-to-server)
  callback(null, localDevOriginPattern.test(origin) || configuredOrigins.includes(origin));
};
