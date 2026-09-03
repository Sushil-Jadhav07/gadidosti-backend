-- Bot participant — a fixed system user so bot-authored messages reuse all existing chat
-- plumbing (chat_messages.sender_id FK, chatService.projectMessage's sender_name/sender_role)
-- unchanged. Run as its own statement — ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as its first reference (the INSERT below).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'bot';

-- Forces the ADD VALUE above to commit before anything below runs — needed because most SQL
-- clients (pgAdmin's Query Tool, psql run with -1/--single-transaction, etc.) execute an entire
-- pasted/opened script as one implicit transaction unless told otherwise, which is exactly what
-- triggers Postgres' "unsafe use of new value 'bot' of enum type user_role" error on the INSERT
-- below. migrate.js doesn't need this (it already runs the two halves as separate client.query()
-- calls, each its own implicit transaction) — this COMMIT is only for running this .sql file
-- directly.
COMMIT;

-- Singleton system user the scripted quick-reply bot posts as. Fixed id (not
-- uuid_generate_v4()) so it's the same row on every environment and every re-run.
INSERT INTO users (id, name, phone, role, status, is_phone_verified, is_email_verified)
VALUES ('00000000-0000-0000-0000-000000000001', 'SSK Assistant', NULL, 'bot', 'active', true, true)
ON CONFLICT (id) DO NOTHING;

-- 'bot' = client is still in the scripted quick-reply menu, nobody else has been pulled in yet.
-- 'human' = escalated — normal free-text chat between whichever of client/broker/driver/admin
-- are involved. One-way transition, never reverts to 'bot'.
ALTER TABLE chat_threads ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'bot'
  CHECK (stage IN ('bot', 'human'));

-- Structured payload for a bot message — currently just { quickReplies: [{id,label}] } for the
-- pill buttons rendered under the bot's latest message. Null for every ordinary human message.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS meta JSONB;
