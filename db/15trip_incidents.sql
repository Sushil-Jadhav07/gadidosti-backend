-- ============================================================
--  SSK LOGISTICS — TRIP INCIDENTS (mid-trip issue reporting)
--  Database: ssk_logistics
--  File:     db/15trip_incidents.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "TRIP INCIDENTS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

DO $$ BEGIN
    CREATE TYPE trip_incident_reason AS ENUM ('accident', 'breakdown', 'traffic_block', 'medical', 'other');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type trip_incident_reason already exists, skipping.';
END $$;

DO $$ BEGIN
    CREATE TYPE trip_incident_status AS ENUM ('reported', 'acknowledged', 'resolved');
EXCEPTION
    WHEN duplicate_object THEN RAISE NOTICE 'Type trip_incident_status already exists, skipping.';
END $$;

-- ------------------------------------------------------------
-- TABLE: trip_incidents
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trip_incidents (
    id            UUID                    PRIMARY KEY DEFAULT uuid_generate_v4(),
    trip_id       UUID                    NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
    driver_id     UUID                    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason        trip_incident_reason    NOT NULL,
    notes         TEXT,
    status        trip_incident_status    NOT NULL DEFAULT 'reported',
    reported_at   TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
    resolved_at   TIMESTAMPTZ,
    resolution    TEXT
);

CREATE INDEX IF NOT EXISTS idx_trip_incidents_trip    ON trip_incidents(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_incidents_driver  ON trip_incidents(driver_id);
CREATE INDEX IF NOT EXISTS idx_trip_incidents_status  ON trip_incidents(status);
