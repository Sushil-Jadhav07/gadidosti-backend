-- ============================================================
--  SSK LOGISTICS — DISPUTE NUMBER (human-readable dispute reference)
--  Database: ssk_logistics
--  File:     db/16dispute_number.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DISPUTE NUMBER" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- dispute_number is a short human-readable reference (e.g. "DSP-001") shown in the UI
-- instead of the raw UUID — same idea as bookings.booking_number, but a flat incrementing
-- sequence rather than month-scoped since dispute volume is much lower.
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS dispute_number VARCHAR(20);

-- Back-fill any disputes created before dispute_number existed, numbering them
-- sequentially in chronological order.
WITH numbered AS (
    SELECT id, 'DSP-' || LPAD(ROW_NUMBER() OVER (ORDER BY created_at)::text, 3, '0') AS generated
    FROM disputes
    WHERE dispute_number IS NULL
)
UPDATE disputes d SET dispute_number = numbered.generated
FROM numbered WHERE d.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_disputes_dispute_number ON disputes(dispute_number);
