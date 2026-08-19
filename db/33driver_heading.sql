-- ============================================================
--  SSK LOGISTICS — DRIVER HEADING (compass bearing on driver_profiles)
--  Database: ssk_logistics
--  File:     db/33driver_heading.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DRIVER HEADING" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Direction of travel in degrees (0-360, 0 = true north), reported by the driver's device GPS
-- alongside current_lat/current_lng (see db/12driver_location.sql). Nullable — the device omits
-- it whenever GPS can't determine heading (e.g. stationary), and PATCH .../me/location leaves
-- this column untouched on that fix rather than overwriting a valid value with unknown.
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS current_heading NUMERIC(5,1);
    