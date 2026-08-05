-- ============================================================
--  SSK LOGISTICS — DRIVER REQUESTS (direct client-to-driver negotiation)
--  Database: ssk_logistics
--  File:     db/25driver_requests.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "DRIVER REQUESTS" block in src/config/migrate.js — keep both in sync)
--
--  Parallel path to the existing job_requests (broker-broadcast) negotiation — this one is
--  for a client who picks a specific truck+driver directly off GET /api/vehicles/trucks/nearby
--  instead of waiting for brokers to respond to a broadcast. Deliberately mirrors
--  job_requests' shape (status enum, offer_history) so the negotiation UI/logic pattern is
--  the same on both sides, just client<->driver instead of client<->broker.
-- ============================================================

DO $$ BEGIN
    CREATE TYPE driver_request_status AS ENUM ('pending', 'countered', 'accepted', 'declined');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type driver_request_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: driver_requests
-- 'pending' = awaiting the driver's response (or the broker's, once driver_timeout_at is
-- set). 'countered' = the driver (or broker) has countered, awaiting the client. Same
-- pending<->countered handoff pattern as job_requests.
--
-- driver_timeout_at: set by src/cron/driverRequestTimeoutSweep.js once the driver hasn't
-- responded within DRIVER_RESPONSE_TIMEOUT_MINUTES of it becoming their turn — from that
-- point on, only broker_id (not driver_id) may act on this request. Null = driver still has
-- their window.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS driver_requests (
    id                  UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id          UUID                    NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    truck_id            UUID                    NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
    driver_id           UUID                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    broker_id           UUID                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount              NUMERIC(12,2),
    status              driver_request_status  NOT NULL DEFAULT 'pending',
    offer_history       JSONB                   NOT NULL DEFAULT '[]'::jsonb,
    driver_timeout_at   TIMESTAMPTZ,
    created_at          TIMESTAMPTZ             DEFAULT NOW(),
    updated_at          TIMESTAMPTZ             DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_requests_booking ON driver_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_driver_requests_driver  ON driver_requests(driver_id);
CREATE INDEX IF NOT EXISTS idx_driver_requests_broker  ON driver_requests(broker_id);
-- Sweep query filters exactly on this combination — keeps the once-a-minute scan cheap.
CREATE INDEX IF NOT EXISTS idx_driver_requests_timeout_sweep
    ON driver_requests(status, driver_timeout_at, updated_at);

DROP TRIGGER IF EXISTS update_driver_requests_updated_at ON driver_requests;
CREATE TRIGGER update_driver_requests_updated_at
    BEFORE UPDATE ON driver_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
