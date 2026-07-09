require('dotenv').config();
const app    = require('./app');
const logger = require('./utils/logger');
const pool   = require('./config/db');
const { runMigrations } = require('./config/migrate');

const PORT = process.env.PORT || 5000;

// Run the full schema migration on every startup (all statements are idempotent).
// This reuses the exact same script `npm run migrate` runs — there is only one
// migration source (config/migrate.js), so a new module can never be live locally
// (migrated by hand) but missing in production (never migrated at all).
const runStartupMigrations = async () => {
  const client = await pool.connect();
  try {
    logger.info('🔄 Running DB migrations...');
    await runMigrations(client);
    logger.info('✅ DB migrations complete');
  } catch (err) {
    logger.error(`❌ Migration error: ${err.message}`);
  } finally {
    client.release();
  }
};

const startServer = async () => {
  await runStartupMigrations();
  const server = app.listen(PORT, () => {
    logger.info(`🚀 SSK Logistics Auth API running on port ${PORT}`);
    logger.info(`📖 Swagger docs: http://localhost:${PORT}/api-docs`);
    logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully');
    server.close(() => { logger.info('Server closed'); process.exit(0); });
  });
};

process.on('unhandledRejection', (reason) => { logger.error('Unhandled Rejection:', reason); });
process.on('uncaughtException',  (err)    => { logger.error('Uncaught Exception:',  err);    process.exit(1); });

startServer();
