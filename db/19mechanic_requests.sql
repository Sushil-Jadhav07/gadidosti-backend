-- ============================================================
--  SSK LOGISTICS — MECHANIC REQUESTS (breakdown assistance workflow)
--  Database: ssk_logistics
--  File:     db/19mechanic_requests.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "MECHANIC REQUESTS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE mechanic_request_status AS ENUM ('requested', 'mechanic_assigned', 'in_progress', 'resolved');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type mechanic_request_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: mechanic_requests
-- One row per breakdown trip_incident (reason='breakdown') — created automatically when the
-- driver reports a breakdown via POST /api/trips/:id/report-issue. mechanic_name/phone are
-- simple text fields the broker fills in once they've arranged one, not a full mechanic user role.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mechanic_requests (
    id                UUID                        PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_incident_id  UUID                        NOT NULL UNIQUE REFERENCES trip_incidents(id) ON DELETE CASCADE,
    status            mechanic_request_status     NOT NULL DEFAULT 'requested',
    mechanic_name     TEXT,
    mechanic_phone    TEXT,
    notes             TEXT,
    created_at        TIMESTAMPTZ                 NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ                 NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mechanic_requests_incident ON mechanic_requests(trip_incident_id);
CREATE INDEX IF NOT EXISTS idx_mechanic_requests_status   ON mechanic_requests(status);

DROP TRIGGER IF EXISTS update_mechanic_requests_updated_at ON mechanic_requests;
CREATE TRIGGER update_mechanic_requests_updated_at
    BEFORE UPDATE ON mechanic_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
