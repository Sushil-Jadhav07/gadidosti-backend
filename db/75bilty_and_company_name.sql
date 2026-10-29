-- ============================================================
--  SSK LOGISTICS — BILTY (LORRY RECEIPT) + COMPANY DISPLAY NAME
--  Database: ssk_logistics
--  File:     db/75bilty_and_company_name.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "BILTY + COMPANY NAME" block in src/config/migrate.js)
--
--  A second document, separate from the GST tax invoice — the Bilty (Lorry Receipt /
--  Goods Consignment Note) is the transporter's own goods-receipt, not a tax document, so it
--  carries no GST/CGST/SGST breakdown. It's auto-emailed to the client the moment a trip is
--  marked Delivered, and can also be re-sent on demand from the booking detail page.
--
--  company_display_name is a plain admin-set fallback company name — shown on both documents
--  whenever the GST-verified legal name (company_legal_name, db/74company_gst_verification.sql)
--  isn't available yet, so the header never depends on that verification having succeeded.
-- ============================================================

ALTER TABLE admin_settings ADD COLUMN IF NOT EXISTS company_display_name TEXT;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS bilty_number TEXT UNIQUE;
