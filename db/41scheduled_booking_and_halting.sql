-- Book Later (deferred broadcast), Find Truck / Search Broker (mutually-exclusive search mode),
-- and inter-city halting charges.
--
-- is_scheduled + broadcast_at: when a client books for a future date/time, the booking row is
-- created immediately (so it exists, e.g. to browse/cancel) but the actual broker/driver
-- broadcast is deliberately deferred until close to the scheduled time (see
-- src/cron/scheduledBookingBroadcastSweep.js) rather than firing immediately like a normal
-- booking. broadcast_triggered_at marks the moment the broadcast actually fired (immediately for
-- a non-scheduled booking, or by the sweep for a scheduled one) — also doubles as the sweep's
-- idempotency guard so a scheduled booking is never broadcast twice.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS broadcast_at TIMESTAMPTZ;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS broadcast_triggered_at TIMESTAMPTZ;

-- search_mode: the client's mutually-exclusive choice of how to find a truck —
-- 'truck' = broadcast the offered amount to every available driver within search_radius_km
--           (first to accept wins, mirrors the existing broker-broadcast fan-out).
-- 'broker' = browse a list of eligible brokers and send the request to exactly one
--            (selected_broker_id), instead of broadcasting to every eligible broker.
-- NULL = legacy behavior (pre-existing clients that don't send search_mode at all) — broadcasts
-- to every eligible broker, unchanged from before this feature.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS search_mode TEXT CHECK (search_mode IN ('broker', 'truck'));
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS search_radius_km NUMERIC(6,2);
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_broker_id UUID REFERENCES users(id) ON DELETE SET NULL;

-- Inter-city halting charges: once a trip's on-road duration exceeds the free grace period for
-- its distance band, an overage charge is computed automatically at delivery time and added to
-- the booking's amount. Stored here too (separately) so the breakdown stays visible/auditable.
ALTER TABLE trips ADD COLUMN IF NOT EXISTS halting_hours NUMERIC(6,2) NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS halting_charge NUMERIC(10,2) NOT NULL DEFAULT 0;
