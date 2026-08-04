-- ============================================================
--  SSK LOGISTICS — BOOKING EXTRA STOPS + NOTHING REQUIRED
--  Database: ssk_logistics
--  File:     db/23booking_stops.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BOOKING EXTRA STOPS + NOTHING REQUIRED" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Extra pickup/drop stops beyond the single pickup_location/drop_location pair — e.g.
-- picking up from two warehouses before heading to drop. Each is a JSONB array of
-- { location, lat, lng } objects; defaults to an empty array rather than null so callers
-- never have to null-check before iterating.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS loading_locations JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS unloading_locations JSONB NOT NULL DEFAULT '[]'::jsonb;

-- createBookingValidation no longer requires pickup_location/drop_location — the DB
-- constraint has to match or every omitted-location booking would 500 on insert instead of
-- saving.
ALTER TABLE bookings ALTER COLUMN pickup_location DROP NOT NULL;
ALTER TABLE bookings ALTER COLUMN drop_location DROP NOT NULL;
