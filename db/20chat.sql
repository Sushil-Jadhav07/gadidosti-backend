-- ============================================================
--  SSK LOGISTICS — LIVE CHAT (chat_threads + chat_messages)
--  Database: ssk_logistics
--  File:     db/20chat.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "CHAT" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- One thread per booking. Participants (client/broker/driver) are derived live from
-- bookings.client_id/broker_id/driver_id at access-check time — not duplicated onto this
-- table — so a driver reassignment automatically changes who can see the thread with no
-- migration or backfill needed.
CREATE TABLE IF NOT EXISTS chat_threads (
    id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id  UUID          NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id          UUID          PRIMARY KEY DEFAULT uuid_generate_v4(),
    thread_id   UUID          NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    sender_id   UUID          NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT          NOT NULL,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_thread  ON chat_messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_unread  ON chat_messages(thread_id, read_at) WHERE read_at IS NULL;
