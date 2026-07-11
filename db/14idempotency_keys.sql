-- ============================================================
--  SSK LOGISTICS — IDEMPOTENCY KEYS
--  Database: ssk_logistics
--  File:     db/14idempotency_keys.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "IDEMPOTENCY KEYS" block in src/config/migrate.js — keep both in sync)
-- ============================================================

-- Snapshots the exact response body returned for a given (key, user, endpoint) the
-- first time it's seen; a duplicate request with the same Idempotency-Key header
-- replays that snapshot verbatim instead of re-running the handler. Scoped by endpoint
-- so the same key value can't accidentally collide across two different routes.
CREATE TABLE IF NOT EXISTS idempotency_keys (
    id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key    TEXT         NOT NULL,
    user_id            UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint           TEXT         NOT NULL,
    response_snapshot  JSONB        NOT NULL,
    created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_idempotency_keys_unique
    ON idempotency_keys(idempotency_key, user_id, endpoint);
