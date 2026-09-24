-- ============================================================
--  SSK LOGISTICS — ADD STAFF ROLE
--  Database: ssk_logistics
--  File:     db/48add_staff_role.sql
--  Run this file in pgAdmin Query Tool on the ssk_logistics DB
--  (mirrors the "STAFF ROLE" block in src/config/migrate.js — keep both in sync)
--
--  A second admin-dashboard role alongside 'admin', created the same way (POST
--  /api/auth/admin/register, admin-only). No permission differences from 'admin' yet — not
--  wired into any authorize(...) checks beyond that route itself, so a 'staff' account can log
--  in but doesn't unlock anything an existing authorize('admin') route wasn't already blocking.
--  Real permission boundaries (what staff can/can't do) are a follow-up, not part of this change.
-- ============================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'staff';
