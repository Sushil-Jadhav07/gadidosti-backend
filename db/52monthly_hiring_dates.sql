-- ============================================================
--  SSK LOGISTICS — MONTHLY HIRING START/END DATE
--  Database: ssk_logistics
--  File:     db/52monthly_hiring_dates.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "MONTHLY HIRING START/END DATE" block in src/config/migrate.js)
--
--  duration_months (a vague "how many months") is replaced by exact start_date/end_date —
--  duration_months itself is kept (nullable, no longer collected on the form) for old rows, and
--  now computed server-side from the date range for display rather than user-entered.
-- ============================================================

ALTER TABLE monthly_hiring_enquiries ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE monthly_hiring_enquiries ADD COLUMN IF NOT EXISTS end_date DATE;
