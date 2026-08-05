const rateLimit = require('express-rate-limit');

// GPS pings are expected to be frequent by design — the driver app throttles itself to
// roughly one PATCH every ~8s while online (see the live-tracking feature), which alone
// already exceeds the general app-wide limiter's 100-req/15min budget (app.js). That limiter
// is also IP-keyed and shared across every route, so two drivers behind the same network
// (office wifi, mobile carrier NAT) exhaust each other's budget together — see app.js's `skip`
// for this route, which hands it off to this dedicated limiter instead.
// Keyed by the authenticated driver's own id (not IP), so drivers never share a budget, and
// sized generously enough that no real GPS-ping cadence should ever hit it.
module.exports = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { success: false, message: 'Too many location updates, please slow down' },
});
