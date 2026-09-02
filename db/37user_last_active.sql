-- Tracks when a driver's session was last actually used (touched on every authenticated
-- request from a driver — see auth.middleware.js). Lets rejectIfActiveSession
-- (auth.controller.js) tell an abandoned session (app closed, phone died, no network) apart
-- from one that's genuinely still in use, instead of blocking a fresh login for up to 30 days
-- just because an old refresh token hasn't been explicitly logged out.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;
