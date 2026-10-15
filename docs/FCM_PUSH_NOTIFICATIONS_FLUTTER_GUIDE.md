# Push Notifications (FCM) — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source, so there
are no file/line references here, only the backend contract and how the web apps
(`gadidosti-client`, `gadidosti-broker-driver`) already handle the same pushes — read as parity
notes for what the Flutter app should replicate, not as anything Flutter-specific that exists yet.

## The idea in one paragraph

Every push notification is tied to a real, persisted notification row — there is no FCM push that
isn't also a row the app could otherwise have found by polling `GET /api/users/notifications`.
One backend function (`NotificationModel.create`) is the single place every notification gets
created, and it's also the only place that ever calls Firebase — so the payload shape is the same
regardless of what triggered it. The practical effect: FCM is a **best-effort nudge**, not the
system of record. If a push never arrives (permission denied, token stale, app killed and the OS
drops it), the notification still exists server-side and the app should still be able to show it
next time it opens.

## Registering a device token

```
POST /api/users/device-token
{ "token": "<fcm-token>", "platform": "android" }   // platform: android | ios | web, optional
```
Upsert — call this every time the FCM SDK hands the app a token, including on every app launch,
not just once after login. Tokens rotate; re-sending the same token is a safe no-op. One user can
have many tokens registered at once (phone + tablet, reinstalls, etc.) — a push fans out to every
token currently on file for that user. A token already registered to a *different* user gets
silently reassigned to whoever just sent it (a physical device token can only ever belong to
whoever is actually logged in on that device right now).

```
DELETE /api/users/device-token
{ "token": "<fcm-token>" }
```
Call this on logout, so a signed-out device stops receiving that user's pushes.

There's no "list my registered devices" endpoint — register/unregister is the whole surface.

## What actually gets sent

Every push is `notification` + `data` together, not data-only:
```json
{
  "notification": { "title": "New Booking Request", "body": "A client wants a truck for ..." },
  "data": {
    "type": "booking",
    "notification_id": "a1b2c3...",
    "booking_id": "...",
    "driver_request_id": "..."
  }
}
```
A few things worth knowing before you wire up handling for this:

- **No Android channel/priority/sound config, no APNs config** — the backend never sets an
  `android: {...}` or `apns: {...}` block. Whatever channel/sound/priority behavior you want is
  entirely the Flutter app's own FCM SDK configuration; the backend has no opinion on it.
- Because `notification` is present (not data-only), the OS shows a tray notification
  automatically in background/killed state with zero app code running — you don't need a
  background handler just to get *something* on screen. You do need one to read `data` and
  deep-link correctly when the user taps it.
- Every value in `data` is a **string** (FCM requires a flat string-only map, so the backend
  stringifies everything that isn't already a string) — a plain numeric-looking id still comes
  through as a bare string like `"123"`, not JSON-quoted weirdly or wrapped.
- `notification_id` is always present — pairs with `PATCH /api/users/notifications/:id/read` if
  you want tapping a push to mark it read directly, without a separate list fetch first.

## Deciding where to navigate — key off the meta fields, not `type`

`type` is coarse and reused across many unrelated situations — `"booking"` alone covers roughly
fifteen different events (new request, accepted, countered, declined, confirmed, cancelled,
timed-out, reassigned...). Both web apps route by **which `data` key is present**, not by `type`
alone, and the Flutter app should do the same:

| If `data` has... | Means | Suggested destination |
|---|---|---|
| `driver_request_id` | A driver-facing negotiation event | Driver's request inbox / that request's card |
| `job_request_id` | A broker-facing negotiation event | Broker's request inbox |
| `trip_id` | Trip created/confirmed/reassigned/status change | Active trip screen (that trip) |
| `booking_id` only (none of the above) | Booking-level event with no live trip yet | That booking's detail/tracking screen |
| `thread_id` | New chat message | That chat thread |
| `incident_id` | Incident reported/resolved | Active trip's incident panel |
| `dispute_id` | Dispute-related | That dispute |
| none of the above (`kyc`, some `general`) | Status-only update | Relevant status screen (KYC, profile), or just surface the notification with no deep link |

Full list of `type` values you'll see: `booking`, `payment`, `incident`, `trip`, `chat`, `kyc`,
`dispute`, `general`. All six also show up in-app via `GET /api/users/notifications` with the same
`type`/`meta` shape — a push is never the only way to learn about one.

## Don't rely on FCM alone for live negotiation urgency

Both web apps used to show a driver/broker's "new request" popup purely off an FCM foreground
push, and moved away from it — notification permission can be silently denied or never prompted,
and a foreground push can be delayed or coalesced by the OS. They now drive that specific moment
(a brand-new driver/job request arriving) off a dedicated socket event instead
(`driver-request-created` / `job-request-created` — see the negotiation API docs for the full
socket contract), and treat the matching FCM push as a secondary channel only — shown as a toast if
the socket already handled it, suppressed via a dedup set if both arrive. If the Flutter app
already holds a live socket connection while in the foreground, prefer that for anything
time-sensitive (a new request, a counter-offer) and let FCM cover the case where the app isn't
open at all.

## Sandbox / testing notes

- Whether a push actually reaches Firebase at all depends on the backend's `PUSH_PROVIDER` env var
  — `firebase` (real `FIREBASE_PROJECT_ID`/`FIREBASE_CLIENT_EMAIL`/`FIREBASE_PRIVATE_KEY` must be
  set) or `fake` (the default when unset — logs the payload server-side and sends nothing). If
  you're testing against a non-production backend and no pushes are ever arriving, check this
  before assuming the Flutter-side integration is broken — the in-app notification row and any
  socket events still fire normally either way, only the actual FCM network call is skipped.
- Push failures (invalid/expired token, etc.) are fire-and-forget server-side — they never fail
  the action that triggered the notification, and a dead token is automatically pruned from the
  backend's records the next time a push attempt against it comes back as invalid.
- Max 500 device tokens per send batch (defensive limit, not something you'll realistically hit).
