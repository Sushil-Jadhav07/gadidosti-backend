-- Mirrors the "STAFF PER-PAGE ACCESS CONTROL" block in src/config/migrate.js.
-- 'staff' (see 48add_staff_role.sql) has been creatable for a while but every admin route still
-- flatly requires role='admin', so a staff account could log in but nothing worked. This column
-- is what an admin grants: which admin-dashboard pages a given staff account can use, by page key
-- (e.g. 'bookings', 'drivers') — see auth.middleware.js's requireAdminPage.
-- Defaults to empty — a staff account has zero access until an admin explicitly grants pages,
-- deliberately, for both new AND already-existing staff rows. Meaningless for role='admin', which
-- stays full-access regardless (never checked).
ALTER TABLE users ADD COLUMN IF NOT EXISTS page_permissions JSONB NOT NULL DEFAULT '[]'::jsonb;
