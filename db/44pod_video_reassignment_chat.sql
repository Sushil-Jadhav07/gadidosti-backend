-- Three independent features:
--
-- 1. Proof-of-delivery photo AND video uploads, with a required minimum (enforced in
--    trip.controller.js before a trip can advance to 'completed', not at upload time — a
--    driver can still upload one now and a second one later). media_type distinguishes photo
--    from video for the frontend, defaulting existing rows to 'image' (all that ever existed
--    before this).
ALTER TABLE trip_pod_photos ADD COLUMN IF NOT EXISTS media_type TEXT NOT NULL DEFAULT 'image';

-- 2. Broker driver-reassignment history — the reassignment mechanism itself already existed
--    (job.controller.js's assignDriver, reused when a trip already exists), just with no
--    dedicated audit trail beyond a generic audit_logs row and no captured reason. This table
--    is the real "who/when/why" history the client-facing booking/job detail pages can show.
CREATE TABLE IF NOT EXISTS driver_reassignments (
    id              UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id      UUID            NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    trip_id         UUID            REFERENCES trips(id) ON DELETE SET NULL,
    from_driver_id  UUID            REFERENCES users(id) ON DELETE SET NULL,
    to_driver_id    UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    from_truck_id   UUID            REFERENCES trucks(id) ON DELETE SET NULL,
    to_truck_id     UUID            REFERENCES trucks(id) ON DELETE SET NULL,
    reason          TEXT,
    reassigned_by   UUID            NOT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_driver_reassignments_booking ON driver_reassignments(booking_id);

-- 3. Broker <-> driver direct chat, independent of any booking — chat_threads.booking_id was
--    NOT NULL + UNIQUE (one thread per booking, never bookingless); relaxed to nullable so a
--    "direct" thread (broker_id + driver_id, no booking) can coexist with the existing
--    booking-scoped ones. The unique constraint on booking_id alone (implied by NOT NULL UNIQUE)
--    is replaced with a partial unique index so bookingless rows don't collide with each other,
--    plus one for the broker/driver pair so the same two people always land back in the same
--    direct thread instead of getting a fresh one every time.
ALTER TABLE chat_threads ALTER COLUMN booking_id DROP NOT NULL;
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS broker_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS driver_id UUID REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE chat_threads DROP CONSTRAINT IF EXISTS chat_threads_booking_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_booking_unique ON chat_threads(booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_threads_direct_unique ON chat_threads(broker_id, driver_id) WHERE booking_id IS NULL;
DO $$ BEGIN
    ALTER TABLE chat_threads ADD CONSTRAINT chat_threads_booking_or_direct_chk
      CHECK (
        (booking_id IS NOT NULL AND broker_id IS NULL AND driver_id IS NULL)
        OR (booking_id IS NULL AND broker_id IS NOT NULL AND driver_id IS NOT NULL)
      );
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
