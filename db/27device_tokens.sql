-- ============================================================
--  SSK LOGISTICS — DEVICE TOKENS (Firebase push notifications)
--  Database: ssk_logistics
--  File:     db/27device_tokens.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DEVICE TOKENS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- One row per device a user is logged into (web + mobile at once is normal) — token is
-- globally unique, not per-user, since the same physical token can never belong to two users
-- at once; re-registering it (e.g. a different account logs into the same device) reassigns
-- user_id via ON CONFLICT rather than erroring.
CREATE TABLE IF NOT EXISTS device_tokens (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT         NOT NULL UNIQUE,
    platform    TEXT,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON device_tokens(user_id);

-- Debounces the "driver's live location has gone stale mid-trip" notification (see
-- src/cron/staleDriverLocationSweep.js) so it's sent once, not every sweep tick — cleared
-- automatically the next time the driver's location actually updates
-- (DriverProfileModel.updateLocation resets it to null).
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS stale_notified_at TIMESTAMPTZ;
