-- ============================================================
--  SSK LOGISTICS — DRIVER PAYMENT QR UPLOAD
--  Database: ssk_logistics
--  File:     db/53driver_qr_code.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DRIVER PAYMENT QR UPLOAD" block in src/config/migrate.js)
--
--  Lets a driver upload a photo of their own bank/UPI app's QR code as an alternative to (or
--  alongside) the generated UPI-intent QR — some drivers' banks don't support the intent format
--  cleanly, or they just prefer their own app's code. Same storage-provider pattern as KYC
--  documents — this column just holds the URL.
-- ============================================================

ALTER TABLE driver_profiles ADD COLUMN IF NOT EXISTS qr_code_url TEXT;
