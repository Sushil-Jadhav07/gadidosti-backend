require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

const { verifyAccessToken } = require('./utils/jwt');
const swaggerSpec   = require('./config/swagger');
const authRoutes    = require('./routes/auth.routes');
const userRoutes    = require('./routes/user.routes');
const kycRoutes     = require('./routes/kyc.routes');
const healthRoutes  = require('./routes/health.routes');
const bookingRoutes = require('./routes/booking.routes');
const pricingRoutes = require('./routes/pricing.routes');
const vehicleRoutes = require('./routes/vehicle.routes');
const brokerRoutes  = require('./routes/broker.routes');
const configRoutes  = require('./routes/config.routes');
const jobRoutes     = require('./routes/job.routes');
const driverRequestRoutes = require('./routes/driverRequest.routes');
const tripRoutes    = require('./routes/trip.routes');
const paymentRoutes = require('./routes/payment.routes');
const disputeRoutes = require('./routes/dispute.routes');
const adminRoutes   = require('./routes/admin.routes');
const chatRoutes    = require('./routes/chat.routes');
const trackingRoutes = require('./routes/tracking.routes');
const invoiceRoutes = require('./routes/invoice.routes');
const errorHandler  = require('./middleware/errorHandler.middleware');
const logger        = require('./utils/logger');
const allowedOrigins = require('./config/corsOrigins');

const app = express();

// Render (and most cloud platforms) sit behind a reverse proxy.
// This tells Express to trust the X-Forwarded-For header so rate-limiting
// and IP detection work correctly.
app.set('trust proxy', 1);

// ─── Security ────────────────────────────────────────────────────────────────
app.use(helmet({
  // Allow Google Sign-In popup to postMessage back to the opener
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
}));
app.use(cors({
  origin: allowedOrigins,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Skipped entirely in development — the broker dashboard alone fires 7+ GETs per
// page load, which blows through any sane limit in minutes during local testing.
if (process.env.NODE_ENV === 'production') {
  app.use(rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    // Raised from 100, then again from 300 — every screen in every app now polls something
    // (negotiation fallback polling, live tracking, trip-active refresh, admin device polls,
    // ...), and once keying was fixed to be per-user (see keyGenerator below) there's no more
    // reason to keep this artificially low just to protect against a shared-IP pileup.
    // Override via RATE_LIMIT_MAX if this still isn't enough.
    max: parseInt(process.env.RATE_LIMIT_MAX) || 600,
    standardHeaders: true,
    legacyHeaders: false,
    // Keyed by the authenticated user's id (decoded from the bearer token right here — not a
    // full `authenticate` call, no DB lookup, just enough to get a stable per-user key) instead
    // of raw IP. This is the actual fix for "too many requests hitting everyone on the VPS":
    // almost every request in this app is authenticated, and on a VPS every request passes
    // through the same nginx reverse proxy — if X-Forwarded-For isn't being forwarded exactly
    // right there (a one-line nginx config detail, easy to get wrong), IP-based keying quietly
    // collapses down to ONE shared bucket for the entire server, so any handful of active users
    // trips the limit for everyone at once. Keying by user id sidesteps that entirely, and as a
    // bonus stops the old "office wifi / mobile carrier NAT" problem this comment used to
    // describe. Only truly unauthenticated requests (login, register, health) fall back to IP,
    // which is the right scope for those anyway (brute-force protection).
    keyGenerator: (req) => {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        try {
          const decoded = verifyAccessToken(authHeader.slice(7));
          if (decoded?.id) return `user:${decoded.id}`;
        } catch {
          // Expired/invalid token — fall through to IP; the route's own `authenticate`
          // middleware will reject the request properly, this is just the rate-limit key.
        }
      }
      return req.ip;
    },
    // Driver GPS pings are frequent by design and get their own, much larger, per-driver
    // limiter instead (driverLocationRateLimit.middleware.js, applied on that route in
    // vehicle.routes.js).
    skip: (req) => req.path === '/api/vehicles/drivers/me/location',
    message: { success: false, message: 'Too many requests, please try again later' },
  }));
}

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ─── Local file uploads (FakeLocalStorageProvider) ────────────────────────────
// NOT safe for production on platforms with an ephemeral filesystem (e.g. Render) —
// this only serves what FakeLocalStorageProvider wrote to disk. Once a real cloud
// storage provider is wired up (STORAGE_PROVIDER), this static mount becomes unused.
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ─── Swagger UI ───────────────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'SSK Logistics API',
  customCss: `
    .swagger-ui .topbar { background-color: #041E42; }
    .swagger-ui .topbar .download-url-wrapper { display: none; }
    .swagger-ui .info .title { color: #041E42; }
    .swagger-ui .btn.authorize { background-color: #1976FF; border-color: #1976FF; color: #fff !important; }
    .swagger-ui .btn.authorize span { color: #fff !important; }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    docExpansion: 'list',
    filter: true,
    displayRequestDuration: true,
  },
}));

// Serve raw swagger JSON
app.get('/api-docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', userRoutes);
app.use('/api', kycRoutes);
app.use('/api', bookingRoutes);
app.use('/api', pricingRoutes);
app.use('/api', vehicleRoutes);
app.use('/api', brokerRoutes);
app.use('/api', configRoutes);
app.use('/api', jobRoutes);
app.use('/api', driverRequestRoutes);
app.use('/api', tripRoutes);
app.use('/api', paymentRoutes);
app.use('/api', disputeRoutes);
app.use('/api', adminRoutes);
app.use('/api', chatRoutes);
app.use('/api', trackingRoutes);
app.use('/api', invoiceRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

module.exports = app;
