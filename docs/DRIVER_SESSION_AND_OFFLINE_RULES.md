# Two New Rules for the Driver App: Single Session, No Going Offline Mid-Trip

Two backend rules just went live, both driver-specific. This doc is what the Flutter app
(`SSK_Cargo`) needs to handle for each. Both are already live and enforced server-side — the app
doesn't need to implement the *rule*, just needs to handle the new error responses correctly and
add the matching frontend affordance the web driver app now has.

---

## 1. Single active session per driver account

**The rule**: once a driver logs in on one device, logging in with the same credentials on a
different device is now blocked — until the first session ends (explicit logout, or an admin
force-clears it). This is enforced on **every** login path (`POST /api/auth/login`,
`POST /api/auth/otp/verify` with `purpose: "login"`, `POST /api/auth/google`) — scoped to
`role === 'driver'` only; client/broker/admin logins are completely unaffected.

### What you'll see

A login attempt on a second device while the first session is still active now returns:
```json
{
  "success": false,
  "message": "This account is already logged in on another device. Log out there first, or contact support to reset your session."
}
```
with HTTP status **`409`**. Handle this like any other login failure — show the message, don't
retry automatically.

### What "ends a session" means

Only an explicit `POST /api/auth/logout` call (from the *first* device) frees the account up for
a login elsewhere. **A session does NOT end just because the app was closed, backgrounded, or
lost connectivity** — there's no heartbeat/timeout mechanism. Practically:

- Make sure your logout button actually calls `POST /api/auth/logout` with the stored
  `refresh_token` in the body — don't just clear local storage and call it done. If the app only
  clears local state without hitting that endpoint, the backend still thinks that session is
  live, and the driver would be unable to log in on a replacement device/reinstall.
- **Known risk, by design of how this is implemented**: if the app is killed/uninstalled/loses
  connectivity permanently without ever calling logout, that driver is locked out of logging in
  anywhere else for up to **30 days** (the refresh token's own expiry) — there's no self-service
  recovery, since they can't call logout without already being authenticated on the now-
  unreachable device. If a driver reports "already logged in on another device" but insists
  they're not logged in anywhere, that's this scenario — the fix is an **admin** action, not
  anything the driver or the app can do:
  ```
  POST /api/admin/users/{driverId}/force-logout
  ```
  (admin-only, ends every session for that user immediately). Pass this along to whoever handles
  support/ops for driver accounts — there's no app-side workaround.

### Nothing else changes

Token shape, refresh-token rotation, and every other auth endpoint are untouched. This is purely
an extra check inserted right before tokens are issued on login.

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
