-- ============================================================
--  SSK LOGISTICS — DRIVER LOCATION (live location on driver_profiles)
--  Database: ssk_logistics
--  File:     db/12driver_location.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DRIVER LOCATION" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Driver's last-known location, pinged periodically by the driver's app while
-- online (even before a trip starts) — distinct from trips.current_lat/current_lng,
-- which only exists once a trip has been created.
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS current_lat NUMERIC(9,6);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS current_lng NUMERIC(9,6);
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS last_location_at TIMESTAMPTZ;
