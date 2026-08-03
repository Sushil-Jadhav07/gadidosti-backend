-- ============================================================
--  SSK LOGISTICS — BOOKING CITY (intra-city same-city validation)
--  Database: ssk_logistics
--  File:     db/22booking_city.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BOOKING CITY" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- The single city both pickup_location and drop_location must fall within for an
-- intra-city booking (enforced in booking.validation.js) — null for inter-city bookings,
-- which cross city lines by definition and have no single "city" to record.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS city TEXT;
