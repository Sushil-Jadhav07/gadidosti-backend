const { Pool } = require('pg');

// SSL only when explicitly turned on (e.g. connecting from your laptop
// to Render's EXTERNAL database URL). Internal Render connections don't need it.
const useSSL = process.env.DB_SSL === 'true';

const baseOptions = {
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
};

// Prefer a single DATABASE_URL (what Render gives you).
// Fall back to individual vars for old local setups.
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ...baseOptions }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT, 10) || 5432,
        database: process.env.DB_NAME || 'ssk_logistics',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        ...baseOptions,
      }
);

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('❌ PostgreSQL error:', err.message);
});

module.exports = pool;