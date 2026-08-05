-- ============================================================
--  SSK LOGISTICS — DRIVER ASSIGNMENT TIMEOUT
--  Database: ssk_logistics
--  File:     db/24driver_timeout.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DRIVER ASSIGNMENT TIMEOUT" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Marks when the "driver not available" notification was sent for a booking stuck in
-- 'confirmed' (client accepted a broker) with no driver assigned 5+ minutes later — see
-- src/cron/driverAssignmentTimeoutSweep.js. Kept null until sent so the sweep (running every
-- minute) never notifies the same booking twice.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS driver_timeout_notified_at TIMESTAMPTZ;
