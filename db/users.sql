-- ============================================================
--  SSK LOGISTICS — Auth & User Management
--  Database: ssk_logistics
--  File:     db/users.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--
--  Order of execution:
--    1. Extensions
--    2. ENUM types
--    3. Tables (users → otps → refresh_tokens → audit_logs)
--    4. Indexes
--    5. Trigger function + Trigger
--    6. Sample data (optional — comment out in production)
-- ============================================================


-- ============================================================
-- STEP 0 — Make sure you are connected to the right database
-- Run this first if needed:
--   CREATE DATABASE ssk_logistics;
--   \c ssk_logistics
-- ============================================================


-- ============================================================
-- STEP 1 — Extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- uuid-ossp gives us uuid_generate_v4() for auto-generating UUIDs


-- ============================================================
-- STEP 2 — ENUM Types
-- ============================================================

-- User roles in the platform
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM (
        'client',   -- books transportation
        'broker',   -- owns/manages truck fleet
        'driver',   -- operates trucks
        'admin'     -- platform operator
    );
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Type user_role already exists, skipping.';
END $$;


-- User account statuses
DO $$ BEGIN
    CREATE TYPE user_status AS ENUM (
        'active',                -- fully verified and active
        'inactive',              -- soft-deleted or manually deactivated
        'blocked',               -- blocked by admin
        'pending_verification'   -- registered but phone not yet verified
    );
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Type user_status already exists, skipping.';
END $$;


-- OTP purposes
DO $$ BEGIN
    CREATE TYPE otp_purpose AS ENUM (
        'registration',    -- verify phone during sign-up
        'login',           -- OTP-based login (passwordless)
        'password_reset',  -- reset forgotten password
        'phone_verify'     -- re-verify phone after change
    );
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Type otp_purpose already exists, skipping.';
END $$;


-- ============================================================
-- STEP 3 — Tables
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: users
-- Core user accounts for all roles (client, broker, driver, admin)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id                  UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                VARCHAR(100)    NOT NULL,
    email               VARCHAR(150)    UNIQUE,                          -- optional, unique when provided
    phone               VARCHAR(15)     UNIQUE NOT NULL,                 -- primary identifier (Indian 10-digit)
    password_hash       TEXT,                                            -- bcrypt hash; NULL if OTP-only login
    role                user_role       NOT NULL DEFAULT 'client',
    status              user_status     NOT NULL DEFAULT 'pending_verification',
    is_phone_verified   BOOLEAN         NOT NULL DEFAULT FALSE,
    is_email_verified   BOOLEAN         NOT NULL DEFAULT FALSE,
    profile_image       TEXT,                                            -- S3 URL or CDN link
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  users                     IS 'All platform users — clients, brokers, drivers, and admins';
COMMENT ON COLUMN users.id                  IS 'Primary key — UUID v4';
COMMENT ON COLUMN users.phone               IS '10-digit Indian mobile number, used as primary login identifier';
COMMENT ON COLUMN users.password_hash       IS 'bcrypt password hash with 12 salt rounds';
COMMENT ON COLUMN users.role                IS 'Platform role: client | broker | driver | admin';
COMMENT ON COLUMN users.status              IS 'Account status managed by admin or verification flow';
COMMENT ON COLUMN users.is_phone_verified   IS 'Set to TRUE after successful OTP verification';
COMMENT ON COLUMN users.profile_image       IS 'URL to profile photo stored on AWS S3';


-- ------------------------------------------------------------
-- TABLE: otps
-- One-time passwords for phone verification and login
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS otps (
    id          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone       VARCHAR(15)     NOT NULL,                               -- phone the OTP was sent to
    otp_code    VARCHAR(6)      NOT NULL,                               -- 6-digit numeric code
    purpose     otp_purpose     NOT NULL DEFAULT 'login',
    is_used     BOOLEAN         NOT NULL DEFAULT FALSE,                  -- TRUE once verified
    attempts    INT             NOT NULL DEFAULT 0,                      -- failed verify attempts
    expires_at  TIMESTAMPTZ     NOT NULL,                               -- OTP becomes invalid after this
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  otps            IS 'OTP records for phone verification and passwordless login';
COMMENT ON COLUMN otps.otp_code   IS '6-digit numeric OTP generated server-side';
COMMENT ON COLUMN otps.is_used    IS 'Prevents OTP reuse — set TRUE after successful verification';
COMMENT ON COLUMN otps.attempts   IS 'Tracks failed attempts; block after threshold (e.g. 5)';
COMMENT ON COLUMN otps.expires_at IS 'OTP expires 10 minutes after creation by default';


-- ------------------------------------------------------------
-- TABLE: refresh_tokens
-- JWT refresh tokens — one per device/session
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  TEXT        NOT NULL UNIQUE,    -- SHA-256 hash of the actual token (never store raw)
    is_revoked  BOOLEAN     NOT NULL DEFAULT FALSE,
    user_agent  TEXT,                           -- browser / device info from request header
    ip_address  INET,                           -- IP at time of token creation
    expires_at  TIMESTAMPTZ NOT NULL,           -- 30 days from creation
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  refresh_tokens            IS 'JWT refresh tokens — supports multi-device login with rotation';
COMMENT ON COLUMN refresh_tokens.token_hash IS 'SHA-256 hash of refresh token; raw token never stored';
COMMENT ON COLUMN refresh_tokens.is_revoked IS 'Set TRUE on logout or token rotation';
COMMENT ON COLUMN refresh_tokens.user_agent IS 'Helps identify which device issued the token';


-- ------------------------------------------------------------
-- TABLE: audit_logs
-- Immutable log of all auth and admin actions
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,    -- NULL if user is deleted
    action      VARCHAR(100) NOT NULL,   -- e.g. USER_LOGIN, PASSWORD_CHANGED, USER_BLOCKED
    entity      VARCHAR(100),            -- table name the action affected (e.g. 'users')
    entity_id   UUID,                    -- ID of the affected record
    meta        JSONB,                   -- extra context (old status, role, etc.)
    ip_address  INET,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  audit_logs        IS 'Append-only audit trail — never update or delete rows here';
COMMENT ON COLUMN audit_logs.action IS 'Action constant, e.g. USER_LOGIN | USER_BLOCKED | PASSWORD_CHANGED';
COMMENT ON COLUMN audit_logs.meta   IS 'JSONB bag for extra context — varies by action type';


-- ============================================================
-- STEP 4 — Indexes
-- ============================================================

-- users
CREATE INDEX IF NOT EXISTS idx_users_phone      ON users(phone);
CREATE INDEX IF NOT EXISTS idx_users_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role       ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status     ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC);

-- otps
CREATE INDEX IF NOT EXISTS idx_otps_phone       ON otps(phone);
CREATE INDEX IF NOT EXISTS idx_otps_expires_at  ON otps(expires_at);
CREATE INDEX IF NOT EXISTS idx_otps_purpose     ON otps(purpose);

-- refresh_tokens
CREATE INDEX IF NOT EXISTS idx_refresh_user_id  ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_hash     ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_expires  ON refresh_tokens(expires_at);

-- audit_logs
CREATE INDEX IF NOT EXISTS idx_audit_user_id    ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action     ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC);


-- ============================================================
-- STEP 5 — Auto-update updated_at Trigger
-- ============================================================

-- Function: sets updated_at = NOW() before any UPDATE on users
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to users table
DROP TRIGGER IF EXISTS trigger_users_updated_at ON users;
CREATE TRIGGER trigger_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- STEP 5b — Google Sign-In columns (idempotent)
-- ============================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255) UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'phone';
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

COMMENT ON COLUMN users.google_id      IS 'Google account sub (unique ID from Google)';
COMMENT ON COLUMN users.auth_provider  IS 'How the user signed up: phone | google | both';


-- ============================================================
-- STEP 6 — Sample Data (optional)
-- Password for all seed users: Admin@123456
-- Hash generated with bcrypt, 12 rounds
--
-- ⚠️  Comment out this section before running in production
-- ============================================================

INSERT INTO users (
    name,
    email,
    phone,
    password_hash,
    role,
    status,
    is_phone_verified,
    is_email_verified
)
VALUES
    (
        'Super Admin',
        'admin@ssklogistics.in',
        '9000000001',
        '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', -- Admin@123456
        'admin',
        'active',
        TRUE,
        TRUE
    ),
    (
        'Rajesh Kumar',
        'client@ssklogistics.in',
        '9000000002',
        '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'client',
        'active',
        TRUE,
        TRUE
    ),
    (
        'Suresh Patel',
        'broker@ssklogistics.in',
        '9000000003',
        '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'broker',
        'active',
        TRUE,
        FALSE
    ),
    (
        'Ramesh Singh',
        'driver@ssklogistics.in',
        '9000000004',
        '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'driver',
        'active',
        TRUE,
        FALSE
    ),
    (
        'Priya Sharma',
        'priya@example.com',
        '9876543210',
        '$2a$12$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
        'client',
        'pending_verification',
        FALSE,
        FALSE
    )
ON CONFLICT (phone) DO NOTHING;


-- ============================================================
-- STEP 7 — Verify (run these SELECT statements to confirm)
-- ============================================================

-- Check tables were created
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('users', 'otps', 'refresh_tokens', 'audit_logs')
ORDER BY table_name;

-- Check ENUM types
SELECT typname, enumlabel
FROM pg_type
JOIN pg_enum ON pg_type.oid = pg_enum.enumtypid
WHERE typname IN ('user_role', 'user_status', 'otp_purpose')
ORDER BY typname, enumsortorder;

-- Check indexes
SELECT indexname, tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('users', 'otps', 'refresh_tokens', 'audit_logs')
ORDER BY tablename, indexname;

-- Check trigger
SELECT trigger_name, event_manipulation, event_object_table
FROM information_schema.triggers
WHERE trigger_schema = 'public';

-- Check seeded users
SELECT id, name, phone, role, status, is_phone_verified, created_at
FROM users
ORDER BY created_at;
