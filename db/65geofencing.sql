-- ============================================================
--  SSK LOGISTICS — GEOFENCING (admin pincode whitelist)
--  Database: ssk_logistics
--  File:     db/65geofencing.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "GEOFENCING" block in src/config/migrate.js — keep both in sync)
--
--  An empty allowed_pincodes table means "no restriction yet" (fail-open) so a fresh
--  deploy doesn't instantly block every booking before an admin populates the list —
--  see GeofenceModel.isAllowed in src/models/geofence.model.js.
-- ============================================================

CREATE TABLE IF NOT EXISTS allowed_pincodes (
    id          UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    pincode     TEXT         NOT NULL UNIQUE,
    label       TEXT,
    active      BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_allowed_pincodes_active ON allowed_pincodes(active);

DROP TRIGGER IF EXISTS update_allowed_pincodes_updated_at ON allowed_pincodes;
CREATE TRIGGER update_allowed_pincodes_updated_at
    BEFORE UPDATE ON allowed_pincodes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS pickup_pincode TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS drop_pincode TEXT;
