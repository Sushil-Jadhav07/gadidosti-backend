require('dotenv').config();
const pool = require('./db');

const migrate = async () => {
  const client = await pool.connect();
  try {
    console.log('🚀 Running migrations...');

    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

      -- ENUM types
      DO $$ BEGIN
        CREATE TYPE user_role AS ENUM ('client', 'broker', 'driver', 'admin');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE user_status AS ENUM ('active', 'inactive', 'blocked', 'pending_verification');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      DO $$ BEGIN
        CREATE TYPE otp_purpose AS ENUM ('registration', 'login', 'password_reset', 'phone_verify');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      -- USERS table
      CREATE TABLE IF NOT EXISTS users (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        name            VARCHAR(100) NOT NULL,
        email           VARCHAR(150) UNIQUE,
        phone           VARCHAR(15) UNIQUE NOT NULL,
        password_hash   TEXT,
        role            user_role NOT NULL DEFAULT 'client',
        status          user_status NOT NULL DEFAULT 'pending_verification',
        is_phone_verified BOOLEAN DEFAULT FALSE,
        is_email_verified BOOLEAN DEFAULT FALSE,
        profile_image   TEXT,
        last_login_at   TIMESTAMPTZ,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW()
      );

      -- OTP table
      CREATE TABLE IF NOT EXISTS otps (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        phone       VARCHAR(15) NOT NULL,
        otp_code    VARCHAR(6) NOT NULL,
        purpose     otp_purpose NOT NULL DEFAULT 'login',
        is_used     BOOLEAN DEFAULT FALSE,
        attempts    INT DEFAULT 0,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- REFRESH TOKENS table
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  TEXT NOT NULL UNIQUE,
        is_revoked  BOOLEAN DEFAULT FALSE,
        user_agent  TEXT,
        ip_address  INET,
        expires_at  TIMESTAMPTZ NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- AUDIT LOG table
      CREATE TABLE IF NOT EXISTS audit_logs (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
        action      VARCHAR(100) NOT NULL,
        entity      VARCHAR(100),
        entity_id   UUID,
        meta        JSONB,
        ip_address  INET,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_users_phone   ON users(phone);
      CREATE INDEX IF NOT EXISTS idx_users_email   ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_role    ON users(role);
      CREATE INDEX IF NOT EXISTS idx_users_status  ON users(status);
      CREATE INDEX IF NOT EXISTS idx_otps_phone    ON otps(phone);
      CREATE INDEX IF NOT EXISTS idx_otps_expires  ON otps(expires_at);
      CREATE INDEX IF NOT EXISTS idx_refresh_user  ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);

      -- Auto-update updated_at trigger
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
      $$ language 'plpgsql';

      DROP TRIGGER IF EXISTS update_users_updated_at ON users;
      CREATE TRIGGER update_users_updated_at
        BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    `);

    // ── Google Sign-In columns (idempotent) ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'phone';
      ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);
    `);

    // ── Profile fields (address, company name) + notifications table ──
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(150);

      CREATE TABLE IF NOT EXISTS notifications (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       VARCHAR(150) NOT NULL,
        message     TEXT NOT NULL,
        type        VARCHAR(50) NOT NULL DEFAULT 'general',
        is_read     BOOLEAN NOT NULL DEFAULT FALSE,
        meta        JSONB,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_notifications_user_id  ON notifications(user_id);
      CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON notifications(user_id, is_read);
      CREATE INDEX IF NOT EXISTS idx_notifications_created  ON notifications(created_at DESC);
    `);

    // ── KYC (broker/driver document verification) ──
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE kyc_status AS ENUM ('not_submitted', 'pending', 'approved', 'rejected');
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;

      ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status kyc_status NOT NULL DEFAULT 'not_submitted';

      CREATE TABLE IF NOT EXISTS kyc_submissions (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id           UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
        documents         JSONB NOT NULL DEFAULT '{}'::jsonb,
        rejection_reason  TEXT,
        reviewed_by       UUID REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at       TIMESTAMPTZ,
        submitted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user_id ON kyc_submissions(user_id);
      CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);
    `);

    // ── KYC status rename: not_submitted/pending/approved -> pending/submitted/verified ──
    // (idempotent — only runs if the old label 'not_submitted' still exists)
    await client.query(`
      DO $$ BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'kyc_status' AND e.enumlabel = 'not_submitted'
        ) THEN
          ALTER TYPE kyc_status RENAME VALUE 'approved' TO 'verified';
          ALTER TYPE kyc_status RENAME VALUE 'pending' TO 'submitted';
          ALTER TYPE kyc_status RENAME VALUE 'not_submitted' TO 'pending';
        END IF;
      END $$;
    `);

    console.log('✅ Migrations complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

migrate();
