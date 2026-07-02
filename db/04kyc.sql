-- ============================================================
--  SSK LOGISTICS — KYC (broker/driver document verification)
--  Database: ssk_logistics
--  File:     db/04kyc.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "KYC" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE kyc_status AS ENUM ('not_submitted', 'pending', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN
        RAISE NOTICE 'Type kyc_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- users — KYC review status (idempotent)
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS kyc_status kyc_status NOT NULL DEFAULT 'not_submitted';

COMMENT ON COLUMN users.kyc_status IS 'Broker/driver document verification status. Clients/admins stay not_submitted (unused).';


-- ------------------------------------------------------------
-- TABLE: kyc_submissions
-- One row per user — document numbers + admin review trail.
-- Resubmission overwrites the same row (upsert on user_id).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS kyc_submissions (
    id                UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id           UUID            NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    documents         JSONB           NOT NULL DEFAULT '{}'::jsonb,   -- e.g. { "license_number": "...", "vehicle_registration_number": "..." }
    rejection_reason  TEXT,
    reviewed_by       UUID            REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at       TIMESTAMPTZ,
    submitted_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  kyc_submissions                  IS 'Broker/driver KYC document numbers + admin review trail';
COMMENT ON COLUMN kyc_submissions.documents        IS 'Document number key/value pairs — schema varies by role (see kyc.controller.js)';
COMMENT ON COLUMN kyc_submissions.rejection_reason IS 'Set by admin when rejecting; cleared on resubmission';

CREATE INDEX IF NOT EXISTS idx_kyc_submissions_user_id ON kyc_submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_kyc_status ON users(kyc_status);
