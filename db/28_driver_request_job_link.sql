-- ============================================================
--  SSK LOGISTICS — DRIVER REQUESTS: LINK TO BROKER-ASSIGN ORIGIN
--  Database: ssk_logistics
--  File:     db/28_driver_request_job_link.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the block in src/config/migrate.js — keep both in sync)
--
--  driver_requests rows are created from two different origins:
--   1. Direct client-pick (client selects a truck off GET /api/vehicles/trucks/nearby) —
--      job_request_id stays NULL.
--   2. Broker-assign (broker picks a driver from their own fleet for an already-negotiated
--      job_requests booking, via POST /api/jobs/requests/:id/assign-driver) — job_request_id
--      is set to that job_requests row.
--  Needed so decline/expiry notifications go to the right party: the client (who picked the
--  truck themselves) in case 1, vs the broker (who picked the driver) in case 2.
-- ============================================================

ALTER TABLE driver_requests ADD COLUMN IF NOT EXISTS job_request_id UUID REFERENCES job_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_driver_requests_job_request ON driver_requests(job_request_id);
