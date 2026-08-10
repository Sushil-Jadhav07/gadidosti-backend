-- ============================================================
--  SSK LOGISTICS — TRACKING LAST KNOWN LOCATION
--  Database: ssk_logistics
--  File:     db/31tracking_last_known.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the block in src/config/migrate.js — keep both in sync)
--
--  Opportunistic cache of each Bolt GPS device's last known position — the vendor API
--  (src/providers/tracking/BoltTrackingProvider.js) is live-only with no history, so if a
--  device goes briefly offline or the vendor call fails, the admin dashboard would show
--  nothing at all. Upserted on every successful vendor fetch (tracking.controller.js);
--  read as a fallback when the live call fails. One row per device, not a history log.
-- ============================================================

CREATE TABLE IF NOT EXISTS tracking_last_known (
  device_imei   TEXT PRIMARY KEY,
  device_name   TEXT,
  latitude      NUMERIC(9,6),
  longitude     NUMERIC(9,6),
  speed         NUMERIC,
  course        NUMERIC,
  ignition      BOOLEAN,
  raw           JSONB,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
