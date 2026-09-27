-- ============================================================
--  SSK LOGISTICS — CASHFREE KYC VERIFICATION
--  Database: ssk_logistics
--  File:     db/54kyc_verification.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "CASHFREE KYC VERIFICATION" block in src/config/migrate.js)
--
--  Automated PAN/Aadhaar/Driving-License checks via Cashfree's Verification Suite — stored in
--  its own column (not inside kyc_submissions.documents) because upsertSubmission REPLACES
--  `documents` wholesale on every resubmission; keeping verification results separate means a
--  resubmit never silently wipes an already-passed check. Purely assistive — it does not
--  auto-approve/auto-reject; the human reviewer (admin/broker) still makes that call, now with
--  these results visible alongside the documents.
-- ============================================================

ALTER TABLE kyc_submissions ADD COLUMN IF NOT EXISTS verification_results JSONB NOT NULL DEFAULT '{}'::jsonb;
