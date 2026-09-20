-- ============================================================
--  SSK LOGISTICS — ONE-TIME REPAIR: desynced truck<->driver links
--  Database: ssk_logistics
--  File:     db/46fix_truck_driver_link_desync.sql
--  Run this file once in pgAdmin Query Tool on the ssk_logistics DB.
--
--  Root cause (now fixed going forward in src/models/truck.model.js,
--  TruckModel.create): creating a truck with a driver preselected wrote
--  trucks.driver_id directly without updating driver_profiles.truck_id or
--  clearing that driver's previous truck link. A driver could end up as
--  trucks.driver_id on more than one truck row (visible in the admin fleet
--  list, which reads straight off trucks.driver_id) while
--  driver_profiles.truck_id — a single column — could only ever point at one
--  of them. Whichever truck it *didn't* point at then silently never matched
--  findNearbyForBroadcast's WHERE t.driver_id = dp.user_id AND dp.truck_id =
--  t.id, so that driver never got Find Truck broadcasts through that truck,
--  regardless of KYC/online status/live location — nothing in the UI ever
--  explained why.
--
--  This repairs any driver already left in that state: for each driver
--  linked (via trucks.driver_id) to more than one truck, keeps exactly one
--  — whichever already matches their current driver_profiles.truck_id, or
--  else their most recently updated truck — and clears driver_id on the
--  rest. Separately, also clears any driver_profiles.truck_id left pointing
--  at a truck whose own driver_id disagrees (points elsewhere, or is null),
--  even for drivers who were never linked to more than one truck.
--
--  Safe to re-run — a no-op once everything's already consistent.
-- ============================================================

DO $$
DECLARE
  rec RECORD;
  keep_truck_id UUID;
BEGIN
  FOR rec IN
    SELECT t.driver_id
    FROM trucks t
    WHERE t.driver_id IS NOT NULL
    GROUP BY t.driver_id
    HAVING COUNT(*) > 1
  LOOP
    -- Prefer whichever truck driver_profiles.truck_id already agrees with...
    SELECT t.id INTO keep_truck_id
    FROM trucks t
    JOIN driver_profiles dp ON dp.user_id = t.driver_id AND dp.truck_id = t.id
    WHERE t.driver_id = rec.driver_id;

    -- ...otherwise the most recently updated truck among the ones pointing at them.
    IF keep_truck_id IS NULL THEN
      SELECT t.id INTO keep_truck_id
      FROM trucks t
      WHERE t.driver_id = rec.driver_id
      ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC NULLS LAST
      LIMIT 1;
    END IF;

    UPDATE trucks
    SET driver_id = NULL, updated_at = NOW()
    WHERE driver_id = rec.driver_id AND id != keep_truck_id;

    UPDATE driver_profiles
    SET truck_id = keep_truck_id, updated_at = NOW()
    WHERE user_id = rec.driver_id;

    RAISE NOTICE 'Driver %: kept truck %, detached the rest', rec.driver_id, keep_truck_id;
  END LOOP;

  UPDATE driver_profiles dp
  SET truck_id = NULL, updated_at = NOW()
  FROM trucks t
  WHERE dp.truck_id = t.id AND t.driver_id IS DISTINCT FROM dp.user_id;
END $$;
