-- ============================================================
--  SSK LOGISTICS — MANDATORY CLIENT GST VERIFICATION
--  Database: ssk_logistics
--  File:     db/67client_gst.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "CLIENT GST VERIFICATION" block in src/config/migrate.js)
--
--  Every client must verify a GSTIN before creating a booking — no opt-out. Kept as
--  plain columns on users rather than the kyc_submissions machinery: a client submits
--  one field and gets one single-shot provider result, not a multi-document review
--  queue. See src/controllers/gst.controller.js and booking.controller.js::createBooking.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE gst_verification_status AS ENUM ('unverified', 'verified', 'failed');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type gst_verification_status already exists, skipping.';
END $$;

ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_number TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_verification_status gst_verification_status NOT NULL DEFAULT 'unverified';
ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_verified_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS gst_verification_result JSONB;

COMMENT ON COLUMN users.gst_verification_status IS 'Client GST verification gate for booking creation. Driver/broker GST verification lives separately in kyc_submissions.';
