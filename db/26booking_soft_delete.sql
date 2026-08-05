-- ============================================================
--  SSK LOGISTICS — BOOKING SOFT DELETE
--  Database: ssk_logistics
--  File:     db/26booking_soft_delete.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BOOKING SOFT DELETE" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Broker/driver "delete" is a soft hide (deleted_at set) — never removes the row, so it stays
-- fully visible to admin (GET /api/bookings ignores deleted_at for role='admin'). Only
-- DELETE /api/bookings/:id called by an actual admin does a real DELETE FROM. deleted_by
-- records who hid it (the broker_id owner — see booking.controller.js's deleteBooking, which
-- uses this same broker_id match for both a real broker and a self-registered driver who is
-- their own broker_id).
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id) ON DELETE SET NULL;
