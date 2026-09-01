-- ============================================================
--  SSK LOGISTICS — TRIP PICKUP OTP
--  Database: ssk_logistics
--  File:     db/36trip_pickup_otp.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "TRIP PICKUP OTP" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- A pickup-verification code, separate from the login OTP system (otps table) — generated once
-- when a trip is created (see TripModel.create), shown persistently to the client (never to the
-- driver/broker — see booking.controller.js's projectBooking, gated to role === 'client'), and
-- the driver has to ask the client for it out loud and type it in to mark the trip picked up
-- (see trip.controller.js's updateTripStatus). Deliberately does NOT expire on its own — it
-- stays valid for however long it takes the driver to actually arrive, only "expiring" once
-- pickup_otp_verified_at is set on a successful match. There is no drop-off/delivery OTP.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_otp_code TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pickup_otp_verified_at TIMESTAMPTZ;
