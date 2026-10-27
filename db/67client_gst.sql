-- ============================================================
--  SSK LOGISTICS — CLIENT GST COLUMNS (superseded — see note below)
--  Database: ssk_logistics
--  File:     db/67client_gst.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "CLIENT GST VERIFICATION" block in src/config/migrate.js)
--
--  SUPERSEDED: client verification was originally this bespoke set of columns (one GSTIN,
--  single-shot, no kyc_submissions). It's since been folded into the same unified KYC flow
--  drivers/brokers use instead (PAN + Aadhaar via DigiLocker + GST, gated on users.kyc_status —
--  see REQUIRED_CHECKS_BY_ROLE.client in kyc.controller.js and createBooking's guard in
--  booking.controller.js). These columns are no longer read or written by any code — left in
--  place rather than dropped (this codebase's migrations are additive-only; nothing here ever
--  DROPs a column), harmless dead schema.
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

COMMENT ON COLUMN users.gst_verification_status IS 'Superseded by users.kyc_status (see REQUIRED_CHECKS_BY_ROLE.client) — unused.';
