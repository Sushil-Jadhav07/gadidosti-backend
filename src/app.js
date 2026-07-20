require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');

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
const tripRoutes    = require('./routes/trip.routes');
const paymentRoutes = require('./routes/payment.routes');
const disputeRoutes = require('./routes/dispute.routes');
const adminRoutes   = require('./routes/admin.routes');
const chatRoutes    = require('./routes/chat.routes');
const errorHandler  = require('./middleware/errorHandler.middleware');
const logger        = require('./utils/logger');

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
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Skipped entirely in development — the broker dashboard alone fires 7+ GETs per
// page load, which blows through any sane limit in minutes during local testing.
if (process.env.NODE_ENV === 'production') {
  app.use(rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
    standardHeaders: true,
    legacyHeaders: false,
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
app.use('/api', tripRoutes);
app.use('/api', paymentRoutes);
app.use('/api', disputeRoutes);
app.use('/api', adminRoutes);
app.use('/api', chatRoutes);

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
