-- One-time cleanup for the double-settlement bug (trip.controller.js#updateTripStatus
-- used to run the settlement/total_trips block on BOTH 'delivered' and 'completed').
-- Fixed in code (see git history) so this only needs to run once against data written
-- before the fix. Run the INSPECT queries first; only run the DELETE/UPDATE once you've
-- confirmed the counts look like what you expect.

-- ── 1. INSPECT: which bookings got more than one settlement row ──
SELECT booking_id, COUNT(*) AS settlement_count
FROM settlements
GROUP BY booking_id
HAVING COUNT(*) > 1
ORDER BY settlement_count DESC;

-- ── 2. INSPECT: the actual duplicate rows, oldest first ──
SELECT s.id, s.booking_id, s.driver_id, s.amount, s.platform_fee, s.status, s.created_at
FROM settlements s
JOIN (
  SELECT booking_id FROM settlements GROUP BY booking_id HAVING COUNT(*) > 1
) dupes ON dupes.booking_id = s.booking_id
ORDER BY s.booking_id, s.created_at ASC;

-- ── 3. CLEANUP: keep the earliest settlement per booking, delete the rest ──
-- (Only run after reviewing step 2 — if any duplicate has status='paid' and the others
-- don't, decide manually which row to keep instead of trusting "earliest wins".)
-- BEGIN;
-- WITH ranked AS (
--   SELECT id, booking_id,
--          ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at ASC) AS rn
--   FROM settlements
-- )
-- DELETE FROM settlements
-- WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── 4. CLEANUP: recompute driver_profiles.total_trips from actual distinct completed
-- bookings, rather than blindly decrementing (safer — self-corrects regardless of how
-- many times any given trip was double-counted historically) ──
-- UPDATE driver_profiles dp
-- SET total_trips = sub.actual_count, updated_at = NOW()
-- FROM (
--   SELECT driver_id, COUNT(DISTINCT booking_id) AS actual_count
--   FROM settlements
--   WHERE driver_id IS NOT NULL
--   GROUP BY driver_id
-- ) sub
-- WHERE dp.user_id = sub.driver_id;
-- COMMIT;
