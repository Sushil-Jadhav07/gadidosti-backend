# Two New Rules for the Driver/Broker App: Single Session, No Going Offline Mid-Trip

Two backend rules just went live, for driver **and broker** accounts. This doc is what the
Flutter app (`SSK_Cargo`) needs to handle for each — the rules are enforced server-side, the app
just needs to react correctly to the new socket event / error responses.

**Revision note**: §1 originally shipped as a hard login-time block (a second login attempt
would get rejected outright). That version had a bad failure mode — an old session with no clean
logout could lock the account out of logging in anywhere for up to 30 days, with no self-service
fix. It's been replaced with the design below: the new login always succeeds, and the *old*
session gets kicked out and notified instead. If you already built against the old 409-on-login
behavior, that response no longer happens — replace it with the socket handling below.

---

## 1. Single active session — kicked out + notified, not blocked

**The rule now**: a driver or broker can only be logged in on one device at a time. Logging in
on a new device **always succeeds** — but it silently ends whatever session was active before it.
That old session gets a real-time socket push telling it what happened, so it can show a message
and clean itself up immediately rather than continuing to act as if it's still logged in.

Enforced on every login path (`POST /api/auth/login`, `POST /api/auth/otp/verify` with
`purpose: "login"`, `POST /api/auth/google`) — scoped to `role === 'driver'` **and**
`role === 'broker'`; client and admin logins are unaffected.

### What the OLD session needs to handle

If the app is logged in and connected to the socket (per `DRIVER_APP_SOCKET_GUIDE.md` §1-2 —
same connection, same auth, nothing new to set up) when another device logs in with the same
account, it receives:

```
event: session-terminated
payload: {
  "reason": "logged_in_elsewhere",
  "message": "Your account was used to log in on another device. You have been logged out here."
}
```

On receipt: show the message (a dialog/snackbar, blocking further use makes sense here), then
log the app out locally — clear stored tokens and navigate to the login screen. Don't bother
calling `POST /api/auth/logout` first; the refresh token is already revoked server-side by the
time this event arrives, so that call would just fail harmlessly. Just clear local state and
route to login, same as any other logout.

```dart
socket.on('session-terminated', (data) {
  showDialog(/* ... "logged out — logged in elsewhere" ... */).then((_) {
    clearStoredAuth();
    router.go('/login');
  });
});
```

### What the NEW login (the device logging in) sees

Nothing special — a normal successful login response, tokens and all. No new error code to
handle on the login call itself anymore.

### Known limitation

This is "soft" enforcement — the old session's access token is still technically valid until its
own natural expiry even after this runs (only the refresh token is revoked, which just stops it
from minting a *new* access token). The actual kick-out depends on the old device being connected
to the socket and reacting to the event. If it's offline/backgrounded at the exact moment this
fires, it'll miss the push and keep working normally until its access token expires on its own —
acceptable for "don't let two people effectively use the account at once," not an airtight
security boundary.

An admin can still force-end every session for a user on demand regardless of socket delivery:
```
POST /api/admin/users/{userId}/force-logout
```
(unrelated to the above now, but kept as a general admin tool — e.g. a compromised account.)

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
