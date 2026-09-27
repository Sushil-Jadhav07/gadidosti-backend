const { Pool, types } = require('pg');

// node-pg's default DATE (OID 1082) parser builds a JS Date at LOCAL midnight, which then
// shifts to the previous/next calendar day once serialized to ISO/UTC (e.g. res.json()) if the
// server isn't at UTC+0 — a plain calendar date (no time-of-day meaning at all, e.g.
// monthly_hiring_enquiries.start_date/end_date, trucks.insurance_expiry) has no business going
// through that conversion. Registering this keeps DATE columns as the raw 'YYYY-MM-DD' string
// Postgres already sends, so what's stored is exactly what every reader gets back, regardless of
// server timezone. TIMESTAMPTZ columns are untouched (own OID, 1184) — they're a real point in
// time and correctly need to be timezone-aware.
types.setTypeParser(1082, (val) => val);

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