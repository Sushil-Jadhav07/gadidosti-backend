-- ============================================================
--  SSK LOGISTICS — Profile fields + Notifications
--  Database: ssk_logistics
--  File:     db/03profile_notifications.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "Profile fields + notifications table" block in
--   src/config/migrate.js — keep both in sync)
-- ============================================================

-- ------------------------------------------------------------
-- users — new profile columns (idempotent)
-- ------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS company_name VARCHAR(150);

COMMENT ON COLUMN users.address       IS 'Free-text mailing/business address, set via PATCH /api/users/profile';
COMMENT ON COLUMN users.company_name  IS 'Business/company name — clients and brokers often book/operate on behalf of a business';


-- ------------------------------------------------------------
-- TABLE: notifications
-- In-app notifications (booking accepted, driver assigned, payment received, etc.)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id          UUID            PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID            NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(150)    NOT NULL,
    message     TEXT            NOT NULL,
    type        VARCHAR(50)     NOT NULL DEFAULT 'general',   -- e.g. booking, payment, system, general
    is_read     BOOLEAN         NOT NULL DEFAULT FALSE,
    meta        JSONB,                                        -- extra context (booking_id, amount, etc.)
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  notifications         IS 'Bell-icon notifications shown to a user (bookings, payments, system alerts)';
COMMENT ON COLUMN notifications.type    IS 'Category used for icon/styling on the frontend';
COMMENT ON COLUMN notifications.is_read IS 'Cleared via PATCH /api/users/notifications/:id/read or /read-all';

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON notifications(user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created  ON notifications(created_at DESC);
