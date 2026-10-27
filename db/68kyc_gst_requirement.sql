-- ============================================================
--  SSK LOGISTICS — GST ADDED AS A REQUIRED DRIVER/BROKER KYC CHECK
--  Database: ssk_logistics
--  File:     db/68kyc_gst_requirement.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "KYC GST REQUIREMENT" block in src/config/migrate.js)
--
--  GST joins PAN/Aadhaar(/Driving License) as a required check for drivers and brokers
--  (see REQUIRED_CHECKS_BY_ROLE in kyc.controller.js). Per explicit decision, this is
--  "mandatory, no exceptions" the same way client GST is — so every driver/broker
--  already sitting at kyc_status='verified' under the old PAN+Aadhaar-only rule is
--  pushed back into the manual review queue ('submitted') until they add + verify GST
--  and get re-approved.
--
--  migrate.js runs this block on every server boot (no migration-tracking table), so
--  this MUST be safe to re-run: the WHERE clause only matches users who don't yet have
--  a verified GST check, so once someone adds GST and is re-approved back to
--  'verified', later re-runs leave them alone instead of re-queuing them forever.
-- ============================================================

UPDATE users
SET kyc_status = 'submitted'
WHERE role IN ('driver', 'broker')
  AND kyc_status = 'verified'
  AND id IN (
    SELECT user_id FROM kyc_submissions
    WHERE kyc_submissions.user_id = users.id
      AND COALESCE(verification_results -> 'gst' ->> 'status', '') != 'verified'
  );
