-- ============================================================
--  SSK LOGISTICS — POD VERIFICATION
--  Database: ssk_logistics
--  File:     db/49pod_verification.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "POD VERIFICATION" block in src/config/migrate.js — keep both in sync)
--
--  POD was previously "compulsory" only in the sense that a driver couldn't reach 'completed'
--  without uploading at least MIN_UPLOADS_PER_TRIP photos — nobody ever reviewed them. This adds
--  an actual client-review step: pod_status tracks 'not_submitted' -> (driver uploads) ->
--  'pending_verification' -> (client approves) -> 'verified', or -> (client rejects) ->
--  'rejected', which sends the driver back to re-upload (another upload while 'rejected' flips
--  it back to 'pending_verification'). The driver's 'delivered' -> 'completed' transition now
--  gates on pod_status = 'verified' instead of just the raw photo count — broker/admin keep
--  their existing manual override.
-- ============================================================

ALTER TABLE trips ADD COLUMN IF NOT EXISTS pod_status TEXT NOT NULL DEFAULT 'not_submitted';
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pod_rejection_reason TEXT;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pod_verified_at TIMESTAMPTZ;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS pod_verified_by UUID REFERENCES users(id);

DO $$ BEGIN
    ALTER TABLE trips ADD CONSTRAINT trips_pod_status_chk
      CHECK (pod_status IN ('not_submitted', 'pending_verification', 'verified', 'rejected'));
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
