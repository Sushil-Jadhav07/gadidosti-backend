-- ============================================================
--  SSK LOGISTICS — KYC status rename
--  Database: ssk_logistics
--  File:     db/05kyc_status_rename.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "KYC status rename" block in src/config/migrate.js)
--
--  Renames the kyc_status enum labels to match the product spec:
--    not_submitted -> pending
--    pending       -> submitted
--    approved      -> verified
--    rejected      -> rejected (unchanged)
--
--  Idempotent — safe to run multiple times; only runs once the old
--  label 'not_submitted' is detected.
-- ============================================================

DO $$ BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = 'kyc_status' AND e.enumlabel = 'not_submitted'
    ) THEN
        ALTER TYPE kyc_status RENAME VALUE 'approved' TO 'verified';
        ALTER TYPE kyc_status RENAME VALUE 'pending' TO 'submitted';
        ALTER TYPE kyc_status RENAME VALUE 'not_submitted' TO 'pending';
    END IF;
END $$;
