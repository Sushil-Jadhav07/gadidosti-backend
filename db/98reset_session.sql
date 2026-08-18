-- Clear every active session for every user
UPDATE refresh_tokens SET is_revoked = true WHERE is_revoked = false;

-- Clear sessions for one user by phone
UPDATE refresh_tokens SET is_revoked = true
WHERE is_revoked = false AND user_id = (SELECT id FROM users WHERE phone = '7894282335');

-- Check who currently has an active session
SELECT u.name, u.phone, u.role, rt.created_at, rt.expires_at
FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
WHERE rt.is_revoked = false AND rt.expires_at > NOW() ORDER BY rt.created_at DESC;
