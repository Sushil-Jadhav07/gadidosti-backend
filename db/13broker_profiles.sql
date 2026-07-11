-- ============================================================
--  SSK LOGISTICS — BROKER PROFILES (service zone + availability)
--  Database: ssk_logistics
--  File:     db/13broker_profiles.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BROKER PROFILES" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- One-to-one with users where role = 'broker'. Unlike driver_profiles, this row is
-- lazily created on first write (BrokerProfileModel.ensure) rather than at KYC time —
-- a broker who never sets a service_city/availability simply has no row, and callers
-- treat that as service_city = NULL, is_online = TRUE (the column default).
CREATE TABLE IF NOT EXISTS broker_profiles (
    user_id         UUID            PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    service_city    TEXT,
    is_online       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_profiles_service_city ON broker_profiles(service_city);

DROP TRIGGER IF EXISTS update_broker_profiles_updated_at ON broker_profiles;
CREATE TRIGGER update_broker_profiles_updated_at
    BEFORE UPDATE ON broker_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
