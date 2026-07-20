-- ============================================================
--  SSK LOGISTICS — NEGOTIATION OFFERS (bid/counter-offer pricing)
--  Database: ssk_logistics
--  File:     db/18negotiation_offers.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "NEGOTIATION OFFERS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- 'countered' sits between 'pending' (awaiting the broker's response) and 'accepted'/'declined' —
-- a job_request flips pending -> countered when a broker counters, and countered -> pending when
-- the client counters back, so the two sides take turns responding.
DO $$ BEGIN
    ALTER TYPE job_status ADD VALUE IF NOT EXISTS 'countered' AFTER 'pending';
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'job_status already has countered, skipping.';
END $$;

-- offer_history is the full back-and-forth for a job_request: every entry is
-- { by: 'client'|'broker', amount, note, at }, oldest first. job_requests.amount always
-- holds the latest offer on the table; offer_history keeps the prior rounds visible to both sides.
ALTER TABLE job_requests ADD COLUMN IF NOT EXISTS offer_history JSONB NOT NULL DEFAULT '[]'::jsonb;
