-- ============================================================
--  SSK LOGISTICS — TRIP STOPS (multi-stop bookings)
--  Database: ssk_logistics
--  File:     db/30trip_stops.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the block in src/config/migrate.js — keep both in sync)
--
--  Ordered sequence of every stop a trip visits — pickup, any extra loading/unloading
--  points (from bookings.loading_locations/unloading_locations), and the final drop —
--  built once at trip creation (see driverRequest.controller.js's finalizeDriverRequest).
--  Each entry: { type: 'pickup'|'loading'|'unloading'|'drop', location, lat, lng,
--  status: 'pending'|'done', completedAt }. Defaults to '[]' for trips created before
--  this migration — the driver app only shows the extra checklist when there are
--  loading/unloading entries, so existing trips are unaffected.
-- ============================================================

ALTER TABLE trips ADD COLUMN IF NOT EXISTS stops JSONB NOT NULL DEFAULT '[]'::jsonb;
