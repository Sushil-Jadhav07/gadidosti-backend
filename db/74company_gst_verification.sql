-- ============================================================
--  SSK LOGISTICS — COMPANY GST VERIFICATION (fetch legal name from Cashfree, not hand-typed)
--  Database: ssk_logistics
--  File:     db/74company_gst_verification.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "COMPANY GST VERIFICATION" block in src/config/migrate.js)
--
--  Company GSTIN (db/72gst_invoice.sql) was a plain free-text admin field. This adds a
--  "Verify & Save" step instead: admin enters the GSTIN, the backend calls the same Cashfree GST
--  verification used for client/driver/broker KYC, and the GSTIN is only saved once it comes
--  back valid — along with the legal business name it returns, printed on every invoice instead
--  of a hardcoded company name.
-- ============================================================

ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS company_legal_name TEXT;
ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS company_gst_verified_at TIMESTAMPTZ;
