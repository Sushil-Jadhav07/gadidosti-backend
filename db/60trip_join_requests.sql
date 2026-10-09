-- ============================================================
--  SSK LOGISTICS — PART-LOAD / SHARED-TRUCK BOOKINGS
--  Database: ssk_logistics
--  File:     db/60trip_join_requests.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the matching block in src/config/migrate.js — keep both in sync)
--
--  Real load-sharing: a second client's smaller booking can join a truck that's
--  ALREADY on_trip for a first client. trips.booking_id stays strictly 1:1/UNIQUE —
--  a joined booking gets its OWN, independent trips row that shares the same
--  truck_id/driver_id as the first trip's booking. capacity_tons is nullable with
--  no backfill — a truck is never a part-load match candidate until its broker/
--  admin sets a real number.
-- ============================================================

ALTER TABLE trucks ADD COLUMN IF NOT EXISTS capacity_tons NUMERIC(6,2);

DO $$ BEGIN
  CREATE TYPE trip_join_request_status AS ENUM ('pending', 'accepted', 'declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS trip_join_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id      UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  target_trip_id  UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  truck_id        UUID NOT NULL REFERENCES trucks(id) ON DELETE CASCADE,
  driver_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount          NUMERIC(12,2),
  status          trip_join_request_status NOT NULL DEFAULT 'pending',
  driver_timeout_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_join_requests_target_trip ON trip_join_requests(target_trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_join_requests_driver ON trip_join_requests(driver_id);

DROP TRIGGER IF EXISTS update_trip_join_requests_updated_at ON trip_join_requests;
CREATE TRIGGER update_trip_join_requests_updated_at
  BEFORE UPDATE ON trip_join_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- A part-load booking targeting a specific on-trip truck (via POST /api/trip-join-requests)
-- shouldn't also get the normal broadcastBooking() fan-out.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_search_mode_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_search_mode_check CHECK (search_mode IN ('broker', 'truck', 'part_load'));
