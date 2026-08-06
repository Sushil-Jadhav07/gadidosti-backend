-- ============================================================
--  SSK LOGISTICS — VPS GO-LIVE RESET
--  Database: ssk_logistics
--  File:     db/99_vps_reset.sql
--
--  Run this ONCE manually via psql/pgAdmin on the VPS before going live.
--  It does NOT touch users, trucks, or driver profiles themselves — only:
--   1. Resets every truck/driver status to 'available'
--   2. Deletes every booking (client + broker), which cascades (ON DELETE
--      CASCADE) through: booking_timeline, settlements, disputes,
--      job_requests, driver_requests, chat_threads -> chat_messages,
--      trips -> trip_timeline, trip_incidents -> mechanic_requests,
--      trip_pod_photos, pod_files.
--
--  Wrapped in a transaction — review the row counts below before COMMIT.
--  Take a DB backup/snapshot before running this. It is NOT reversible
--  once committed.
-- ============================================================

BEGIN;

-- Free up every truck and driver so they show as available again
UPDATE trucks SET status = 'available', updated_at = NOW();
UPDATE driver_profiles SET status = 'available', updated_at = NOW();

-- Wipe all bookings (client + broker) — cascades through the entire
-- booking/trip dependency tree, see header comment above.
DELETE FROM bookings;

-- Optional: also clear notification history left behind (notifications
-- reference booking/trip ids only inside the meta JSONB, not a real FK,
-- so they are NOT cascade-deleted above and would otherwise remain as
-- orphaned history pointing at bookings that no longer exist).
-- Uncomment if you want a clean notification inbox too:
-- DELETE FROM notifications;

-- Sanity check before committing — expect 0 bookings/trips/driver_requests/
-- job_requests, and every truck/driver row showing 'available'.
SELECT
  (SELECT COUNT(*) FROM bookings)                                   AS bookings_left,
  (SELECT COUNT(*) FROM trips)                                      AS trips_left,
  (SELECT COUNT(*) FROM driver_requests)                            AS driver_requests_left,
  (SELECT COUNT(*) FROM job_requests)                                AS job_requests_left,
  (SELECT COUNT(*) FROM trucks WHERE status != 'available')          AS trucks_not_available,
  (SELECT COUNT(*) FROM driver_profiles WHERE status != 'available') AS drivers_not_available;

-- If the counts above all read 0, run:
COMMIT;
-- Otherwise run ROLLBACK; instead and investigate before retrying.
