# Broker Driver-Distance Limit & KYC Status Caching — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as the other guides in this folder) — no file/line references, just the backend
contract and what the web apps already do with it. Covers what changed recently that isn't
already covered by its own guide — see the **Related guides** section at the bottom for the rest.

## 1. New: broker's driver-assignment now enforces a 50km distance limit

**`POST /api/jobs/{id}/assign-driver`** (broker only — a broker assigning one of their own
fleet's drivers to a booking they've already accepted) can now fail with a new error:

```json
{ "success": false, "message": "This driver is 83km from pickup — only drivers within 50km can be assigned." }
```
`422`, no `errors.code` — it's a plain validation-style message, show it as-is (toast/snackbar).

**Why:** a broker could previously assign any driver in their fleet regardless of where that
driver actually was — including one hundreds of km from the pickup point, which obviously can't
fulfil the trip. This matches the same 50km radius already used everywhere else a driver's
proximity to a pickup matters (the "Find Truck" broadcast, and admin's own direct-assign).

**Fails open, not closed:** if the booking's pickup coordinates or the driver's current location
are missing (stale/never-reported GPS), the check is skipped entirely and the assignment goes
through — same convention as every other driver-proximity check in this system. Don't add a
client-side "driver must have a location" requirement on top of this; the backend already
handles the missing-location case correctly by allowing it.

**What to check in `SSK_Cargo`:** if there's a broker-side "pick a driver for this job" screen
calling this endpoint, handle the new 422 the same way as any other validation error from it —
show the message, let the broker pick a different (closer) driver. No new field to read, no
change to a successful response's shape.

## 2. KYC status: cache it, don't re-fetch-and-trust-blindly on every load

Not a new endpoint or field — a correctness note on a bug just fixed in `gadidosti-client` (the
web client app) that's worth checking for in `SSK_Cargo` too, since the same mistake is easy to
make independently in a second codebase.

**The bug:** the web client's KYC gate fetched `GET /api/kyc/status` fresh on every app
load/login and trusted whatever that call returned *immediately* — including `null`/not-yet-
resolved while the request was still in flight. Its route guard reads "not verified" as the
default, so a client who had already completed KYC in a previous session would get bounced back
to the verification screen for the length of that fetch (or permanently, if the fetch failed) —
even though they were genuinely already verified. Over Wi-Fi this was a half-second flash;
on a slow/flaky mobile connection it could show the KYC screen for noticeably longer, or not
self-correct at all if the request failed.

**The fix (web):** cache a sticky "verified" flag (scoped per user id, in `localStorage`) the
moment `kyc_status` is confirmed `"verified"`. On every later login/app-load, trust that cached
flag immediately instead of defaulting to "not verified" while a fresh fetch is still pending —
the fetch still runs in the background and corrects the cache if the real status ever changes
(an admin reverts someone, etc.), it just never gets to *flash* a wrong "not verified" state in
the meantime.

**Check in `SSK_Cargo`:** if the client-role KYC gate reads `kyc_status` from a value that starts
`null`/unknown on each app launch and only becomes trustworthy after a network round-trip
completes, it has the same exposure. The broker/driver side of this app (`gadidosti-broker-
driver`, the web broker/driver app) was checked too and does **not** have this bug — it caches
`kyc_status` on the logged-in user object itself (set at login, which is always a fresh DB read,
and corrected in the background without ever resetting to null/unknown first). That's the pattern
to copy if `SSK_Cargo`'s client role doesn't already do something equivalent: keep the last-known
value authoritative across app restarts, and only ever *update* it from a successful fetch, never
blank it out while waiting on one.

## Related guides (same batch of changes, already documented separately)

- **`CLIENT_VERIFICATION_WALLET_GEOFENCING_FLUTTER_GUIDE.md`** — landmark/POI autocomplete picks
  (e.g. "India Gate") can come back with no pincode and need a reverse-geocode fallback, or they
  wrongly trip the geofence's "precise pincode required" block even for a whitelisted area.
- **`BOOKING_STUCK_ESCALATION_FLUTTER_GUIDE.md`** — bookings stuck 30+ minutes with no response
  now auto-escalate (admin notified, search radius widened once); `GET /api/bookings/{id}/driver-
  requests` gained a `searchDelayed` field for the waiting screen to show a real, server-confirmed
  message instead of only a local elapsed-time guess.

Nothing in this guide applies to the admin dashboard changes from the same batch (an admin/staff
live-update socket event, a "Driver" → "Lorry Owner" display rename, and PWA installability for
the three web apps) — none of that touches the mobile app or its API contract.
