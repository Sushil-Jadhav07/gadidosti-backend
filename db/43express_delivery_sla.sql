-- Two related features:
--
-- 1. Delivery Time & Delay/Halting Rules — a distance-tiered "expected delivery time" (total
--    door-to-door duration, e.g. 300km -> 36h), distinct from the existing inter-city halting
--    grace-period feature (db/41scheduled_booking_and_halting.sql's trips.halting_hours/
--    halting_charge, which measures time spent STOPPED, not total trip duration). Both can
--    independently apply to the same trip — a truck can run over its overall delivery SLA
--    without any single halt exceeding the halting grace period, or vice versa. Computed and
--    stored on trips (not just derived on read) so the figure stays fixed/auditable even if the
--    admin later changes the SLA tiers.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS expected_delivery_hours NUMERIC(6,2);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS sla_overage_hours NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS sla_overage_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

-- 2. Express Delivery — an intra-city-only faster service tier (confirmed scope), +20% of the
--    normal freight amount (configurable — see pricing_config.expressService), with a tighter
--    delivery deadline (the same distance-tiered SLA above, multiplied by a configurable
--    "faster" factor) and optional informational transit insurance.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_express BOOLEAN NOT NULL DEFAULT FALSE;
