-- ============================================================
--  SSK LOGISTICS — DELIVERY COMPLETION (multi-photo POD + driver QR + COD tracking)
--  Database: ssk_logistics
--  File:     db/21delivery_completion.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DELIVERY COMPLETION" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: trip_pod_photos
-- Up to 6 proof-of-delivery photos per trip. trips.pod_url is kept populated with
-- the first photo's URL (set once, never overwritten by later uploads) so any
-- existing code that only reads the single pod_url column keeps working.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_pod_photos (
    id            UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id       UUID            NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    url           TEXT            NOT NULL,
    uploaded_at   TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_pod_photos_trip ON trip_pod_photos(trip_id);

-- ------------------------------------------------------------
-- Driver's personal UPI QR (uploaded once via POST /api/driver/payment-qr, reused
-- across every trip they deliver) and COD/UPI collection tracking on bookings.
-- ------------------------------------------------------------
ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS payment_qr_url TEXT;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_mode TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;
