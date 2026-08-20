-- ============================================================
--  SSK LOGISTICS — BOOKING PARTIAL PAYMENT (20% advance for >5k bookings)
--  Database: ssk_logistics
--  File:     db/34booking_partial_payment.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BOOKING PARTIAL PAYMENT" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Bookings over the advance threshold (see ADVANCE_PAYMENT_THRESHOLD in booking.controller.js)
-- can be confirmed with a 20% advance instead of full payment — 'partial' sits between
-- 'pending' (nothing paid) and 'paid' (fully settled), matching what payBooking/collectPayment
-- now write.
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'partial';

-- How much of bookings.amount has actually been paid so far — 0 while pending, the 20% advance
-- while 'partial', and the full amount once 'paid'. Lets the driver app's collect-payment step
-- show the true remaining balance instead of always showing the full booking amount.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0;
