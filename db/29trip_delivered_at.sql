-- ============================================================
--  SSK LOGISTICS — TRIP DELIVERED_AT (delivery time-taken tracking)
--  Database: ssk_logistics
--  File:     db/29trip_delivered_at.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the block in src/config/migrate.js — keep both in sync)
--
--  Set once, the first time a trip's status moves to 'delivered' (trip.controller.js's
--  updateTripStatus) — same one-time-write pattern trips.started_at already uses. Lets
--  "time taken" be computed as delivered_at - started_at instead of needing a fresh
--  trip_timeline lookup every time.
-- ============================================================

ALTER TABLE trips ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
