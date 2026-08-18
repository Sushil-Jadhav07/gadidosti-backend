# Two New Rules for the Driver/Broker App: Single Session, No Going Offline Mid-Trip

Two backend rules just went live, for driver **and broker** accounts. This doc is what the
Flutter app (`SSK_Cargo`) needs to handle for each — the rules are enforced server-side, the app
just needs to react correctly to the new socket event / error responses.

**Revision history** — this went through three designs before landing; if you built against an
earlier version, this supersedes it:
1. **v1**: second login blocked outright, no notification to anyone. Problem: an old session
   with no clean logout could lock the account out of logging in anywhere for up to 30 days,
   with no self-service fix.
2. **v2**: second login always succeeded instead, silently kicking out and notifying the old
   session. Problem: wrong shape — the *first* device is the legitimate one and shouldn't be the
   one that loses, just because someone else (possibly not even the account owner) attempted to
   log in.
3. **v3, current**: back to blocking the second attempt (like v1), **plus** a real-time,
   informational security alert to the existing session (new in v3) so the legitimate user finds
   out someone tried. Described below.

---

## 1. Single active session — second attempt blocked, first session alerted

**The rule**: a driver or broker can only be logged in on one device at a time. A second login
attempt with the same credentials while a session is already active is **blocked** — the
existing session is completely untouched (nothing revoked, no forced logout) — and that existing
session receives a real-time, single-acknowledgment alert that someone just tried.

Enforced on every login path (`POST /api/auth/login`, `POST /api/auth/otp/verify` with
`purpose: "login"`, `POST /api/auth/google`) — scoped to `role === 'driver'` **and**
`role === 'broker'`; client and admin logins are unaffected.

### What the blocked (new) login attempt sees

```json
{
  "success": false,
  "message": "This account is already logged in on another device. Log out there first, or contact support to reset your session."
}
```
HTTP `409`. Show it like any other login failure — no retry, no special handling.

### What the EXISTING (already logged-in) session sees

If it's connected to the socket (per `DRIVER_APP_SOCKET_GUIDE.md` §1-2 — same connection, same
auth, nothing new to set up) at the moment someone else attempts to log in, it receives:

```
event: login-attempt-alert
payload: { "message": "Someone just tried to log in to your account from another device. If this wasn't you, please contact support." }
```

Show this as a simple, single-button acknowledgment dialog — **not** a two-option prompt (no
"Allow"/"Deny", nothing to decide). The session that receives this is completely unaffected —
don't log it out, don't navigate anywhere, just show the message and let the user dismiss it and
keep working normally.

```dart
socket.on('login-attempt-alert', (data) {
  showDialog(
    context: context,
    builder: (_) => AlertDialog(
      title: const Text('Login attempt blocked'),
      content: Text(data['message'] ?? 'Someone just tried to log in to your account from another device.'),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('OK'))],
    ),
  );
});
```

### The operational risk this still carries, and the fixes for it

Because the block is permanent until the existing session logs out (or its refresh token
naturally expires), the same lockout risk as v1 still applies: if a driver's app is killed/
uninstalled without ever calling `POST /api/auth/logout`, they can't log in anywhere else for up
to **30 days**. Two ways to clear it:

- **Admin API** (no direct DB access needed):
  ```
  POST /api/admin/users/{userId}/force-logout
  ```
- **Direct SQL** (run on the Postgres database — psql/pgAdmin) — see §3 below.

---

## 2. A driver can't be marked offline while on an active trip

**The rule**: if a driver's status is `on_trip`, they can no longer be flipped to `offline`.
This closes a real gap — a driver mid-delivery going offline is exactly the state a client/broker
tracking screen can't tolerate (no live location, no way to know if something's wrong).

### Backend enforcement

`PATCH /api/vehicles/drivers/:id` (broker/admin only — a driver was never able to call this
directly) now rejects `status: "offline"` with **`409`** if the driver's current status is
`on_trip`:
```json
{ "success": false, "message": "This driver has an active trip — cannot be marked offline until it ends." }
```
`status: "available"` is still allowed in every state (this only blocks the specific
`on_trip → offline` transition).

### What the Flutter app should add — matching the web driver app

The web driver app (`gadidosti-broker-driver`) has an Online/Offline switch in its top header.
It already had logic to keep location pings flowing during an active trip regardless of the
toggle (`driverTrackingEnabledProvider`'s Flutter equivalent — `driverOnlineProvider ||
driverActiveTripIdProvider is set`, which your app already has per
`driver_tracking_state_provider.dart`) — but the switch itself could still be visually flipped
off, which was misleading even though tracking secretly kept running. That's now fixed there and
should be matched here:

**In `driver_home_screen.dart`'s online `Switch`**, block turning it off while
`driverActiveTripIdProvider` is set — don't just rely on the backend guard (that endpoint isn't
even one the driver app calls; this toggle is local-only, same as the web app), disable the
interaction itself:

```dart
final hasActiveTrip = (ref.watch(driverActiveTripIdProvider) ?? '').trim().isNotEmpty;
final isOnline = ref.watch(driverOnlineProvider);

Switch(
  value: isOnline,
  onChanged: (isOnline && hasActiveTrip)
      ? null // disabled — can't turn off while on an active trip; turning ON is still fine
      : (value) => ref.read(driverOnlineProvider.notifier).state = value,
  ...
)
```
Consider also wrapping it in a `Tooltip`/showing a small inline note ("Can't go offline during
an active trip") when disabled, matching the title-attribute hint added to the web version's
button.

---

## 3. SQL — manually clear sessions

Run directly on the Postgres database (psql/pgAdmin) when you need to unblock an account without
going through the admin API — e.g. while testing, or if the API itself is unreachable. All of
these just set `is_revoked = true` on `refresh_tokens` rows, the exact same effect
`RefreshTokenModel.revokeAllForUser` has — nothing destructive, the rows stay for audit history.

**Clear every active session for every user** (the blunt "reset everything" option — good for
clearing out test accounts mid-development):
```sql
UPDATE refresh_tokens SET is_revoked = true WHERE is_revoked = false;
```

**Clear sessions for one specific user, by phone number:**
```sql
UPDATE refresh_tokens
SET is_revoked = true
WHERE is_revoked = false
  AND user_id = (SELECT id FROM users WHERE phone = '7894282335');
```

**Clear sessions for one specific user, by email:**
```sql
UPDATE refresh_tokens
SET is_revoked = true
WHERE is_revoked = false
  AND user_id = (SELECT id FROM users WHERE email = 'harshofficial@gmail.com');
```

**Check who currently has an active session** (useful before/after running any of the above, to
confirm it worked):
```sql
SELECT u.name, u.phone, u.role, rt.created_at, rt.expires_at
FROM refresh_tokens rt
JOIN users u ON u.id = rt.user_id
WHERE rt.is_revoked = false AND rt.expires_at > NOW()
ORDER BY rt.created_at DESC;
```

If you'd rather hard-delete instead of just revoking (e.g. to fully clean up test data, not just
deactivate it), swap `UPDATE ... SET is_revoked = true` for `DELETE FROM refresh_tokens` with the
same `WHERE` clause — functionally equivalent for unblocking logins, just doesn't keep the row
around afterward.
