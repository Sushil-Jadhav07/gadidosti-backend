-- ============================================================
--  SSK LOGISTICS — PRICING CONFIG + ADMIN SETTINGS (singletons)
--  Database: ssk_logistics
--  File:     db/10settings_pricing.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "SETTINGS + PRICING" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- ------------------------------------------------------------
-- TABLE: pricing_config
-- Singleton row (fixed id) holding the nested pricing rules the admin
-- Pricing page reads/writes as one JSONB blob. See pricing.model.js for shape.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pricing_config (
    id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    config      JSONB         NOT NULL,
    updated_at  TIMESTAMPTZ   DEFAULT NOW()
);

-- ------------------------------------------------------------
-- TABLE: admin_settings
-- Singleton row (fixed id) for the admin Settings page.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_settings (
    id                   UUID           PRIMARY KEY DEFAULT uuid_generate_v4(),
    platform_name        TEXT           NOT NULL DEFAULT 'SSK Logistics',
    contact_email        TEXT           NOT NULL DEFAULT 'support@ssklogistics.in',
    commission_rate      NUMERIC(5,2)   NOT NULL DEFAULT 10,
    email_alerts         BOOLEAN        NOT NULL DEFAULT TRUE,
    sms_alerts           BOOLEAN        NOT NULL DEFAULT TRUE,
    push_notifications   BOOLEAN        NOT NULL DEFAULT TRUE,
    updated_at           TIMESTAMPTZ    DEFAULT NOW()
);

-- Fixed IDs so app code addresses these singleton rows without a lookup query.
INSERT INTO pricing_config (id, config)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    '{
        "intraCity": {
            "small":  { "baseFare": 500,  "perKmRate": 25, "platformFee": 0.10, "waitingCharge": 100, "demandMultiplier": 1 },
            "medium": { "baseFare": 800,  "perKmRate": 35, "platformFee": 0.10, "waitingCharge": 150, "demandMultiplier": 1 },
            "large":  { "baseFare": 1200, "perKmRate": 45, "platformFee": 0.10, "waitingCharge": 200, "demandMultiplier": 1 }
        },
        "interCity": {
            "baseRatePerKm": 40,
            "fuelSurcharge": 0.15,
            "tollHandling": "fixed",
            "tollFixedAmount": 500,
            "platformFee": 0.08
        },
        "partTruck": {
            "platformFee": 0.12
        }
    }'::jsonb
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO admin_settings (id)
VALUES ('00000000-0000-0000-0000-000000000002')
ON CONFLICT (id) DO NOTHING;
