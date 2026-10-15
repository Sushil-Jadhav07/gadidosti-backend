-- ============================================================
--  SSK LOGISTICS — ACCOUNT DELETION REQUEST → REAL ACCOUNT LINK
--  Database: ssk_logistics
--  File:     db/64account_deletion_user_link.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the matching block in src/config/migrate.js — keep both in sync)
--
--  account_deletion_requests was originally only reachable from the public,
--  logged-out legal page (free-text name/email/phone, no way to resolve which
--  real account it meant). Now that a logged-in client/driver/broker can also
--  request deletion from inside the app, that request can link straight to
--  their real account — letting an admin actually action it (soft-delete via
--  the existing UserModel.delete) instead of having to manually search Users
--  for a matching name/email/phone first. NULL still means "no linked
--  account" for a request submitted the old, anonymous way.
-- ============================================================

ALTER TABLE account_deletion_requests
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
