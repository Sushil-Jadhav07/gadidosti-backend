-- One-time repair for the one-sided driver<->truck link bug (vehicle.controller.js's
-- createDriver/registerDriver/updateDriver used to write driver_profiles.truck_id directly
-- without ever setting the matching trucks.driver_id). TruckModel.findNearby requires the
-- link to hold on BOTH sides, so any truck caught in this state silently never appeared in
-- nearby-truck search, even with a fully available, located, KYC-verified driver.
-- Fixed in code (see git history) so this only needs to run once against data written
-- before the fix. Run the INSPECT queries first; only run the UPDATE once you've confirmed
-- the rows look like what you expect.

-- ── 1. INSPECT: drivers whose truck_id points at a truck that doesn't point back ──
SELECT dp.user_id AS driver_id, dp.truck_id AS driver_says_truck,
       t.id AS truck_id, t.driver_id AS truck_says_driver
FROM driver_profiles dp
JOIN trucks t ON t.id = dp.truck_id
WHERE t.driver_id IS DISTINCT FROM dp.user_id;

-- ── 2. INSPECT: trucks whose driver_id points at a driver that doesn't point back ──
SELECT t.id AS truck_id, t.driver_id AS truck_says_driver,
       dp.user_id AS driver_id, dp.truck_id AS driver_says_truck
FROM trucks t
JOIN driver_profiles dp ON dp.user_id = t.driver_id
WHERE dp.truck_id IS DISTINCT FROM t.id;

-- ── 3. REPAIR: make trucks.driver_id agree with driver_profiles.truck_id ──
-- (driver_profiles.truck_id is treated as the source of truth here since it was the side
-- these buggy endpoints actually wrote to. If a truck already has a *different* driver_id
-- set from a legitimate assign-driver call, this will overwrite it — review query 1's
-- output first and resolve any such conflicts manually before running this.)
-- BEGIN;
-- UPDATE trucks t
-- SET driver_id = dp.user_id, updated_at = NOW()
-- FROM driver_profiles dp
-- WHERE dp.truck_id = t.id
--   AND t.driver_id IS DISTINCT FROM dp.user_id;
-- COMMIT;
