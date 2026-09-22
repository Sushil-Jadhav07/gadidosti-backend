# Driver Status, Pickup OTP & Session Reset — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Checked against the actual `SSK_Cargo/lib` code. One of these
three is real, needed Flutter work — `driverOnlineProvider` has the exact same bug the web
broker-driver app had.

## 1. Online/Offline toggle — real bug, needs a Flutter fix

**The bug (found on the web driver app, but it's identical here):** the toggle never told the
server anything. `core/providers/driver_tracking_state_provider.dart` is a plain
`StateProvider<bool>`, and `driver_home_screen.dart` (~line 148) just does
`ref.read(driverOnlineProvider.notifier).state = value` — local state only. Turning it **on**
only ever became true in the backend's `driver_profiles.status` as a side effect of the first
location ping landing (a self-heal in `DriverProfileModel.updateLocation`). Turning it **off**
had no server effect at all — the backend status stayed `available` until a 5-minute cleanup job
caught it. So an admin, a broker, or a client's Find Truck search could keep seeing a driver as
available for minutes after they'd gone offline in their own app.

**New endpoint, built for this:**

```
PATCH /api/vehicles/drivers/me/status
Body: { "status": "available" | "offline" }
```

- Driver-only (their own token).
- Only `available`/`offline` are accepted — never send `on_trip`, that's set automatically by the
  trip flow, not something the driver toggles.
- Returns `409` if the driver currently has an active trip — status is locked to the trip while
  one's in progress, same rule `driver_home_screen.dart` should already be enforcing on the UI
  side (don't let the toggle move while a delivery is active).

**What to change:** wherever `driverOnlineProvider.notifier).state = value` is set, also call
this endpoint with the matching status, the same way `core/network/api_client.dart` already
calls `PATCH /api/vehicles/drivers/me/location`. Treat it as best-effort (log a failure, don't
block the UI toggle on it) — same as the web fix.

## 2. Pickup OTP appearing "stuck" — no Flutter change needed, but know why

**The bug (web only):** confirming pickup checks two things in order — a GPS-proximity test
first, *then* the OTP. The proximity check reads `trips.current_lat/lng` (set via
`PATCH /api/trips/:id/location`), a different column from the driver's general location
(`driver_profiles.current_lat/lng`, set via `.../drivers/me/location`). The web app's
location-heartbeat only refreshed the general one; on a stationary desktop browser where the GPS
callback fires rarely, the trip's own location went stale, so a driver could type the correct
code and still get rejected with a location error that reads like the OTP itself is broken.

**Why Flutter is fine:** `api_client.dart` (~line 1425 and ~1450) already calls both
`.../drivers/me/location` and `/api/trips/$tripId/location` together on every position update —
this is exactly the fix that was missing on the web side. Native mobile location updates are
also far more frequent/reliable than a desktop browser's, so the staleness window this bug
depended on is unlikely to occur here. Nothing to change, just worth knowing if a similar report
ever comes in from a driver on the app: check that `trips/:id/location` calls are actually
landing (not silently failing) before assuming the OTP itself is wrong.

## 3. Driver session reset — admin/broker web only, no Flutter change

New feature, not a bug fix: an admin or broker can now force-end every active session for one
driver (all their refresh tokens revoked), for when a driver's app was force-closed or lost
connectivity without logging out — `auth.controller.js`'s `hasBlockingDriverSession` only allows
one active session per driver, so without this they'd be stuck unable to log in on a new device
or after reinstalling for up to 30 days.

**Where the button is:**
- **Admin Dashboard:** Drivers page → click a driver in the list to select them → their detail
  panel on the right → **Reset Session** button, below the Edit/Delete row.
- **Broker panel:** Drivers page → click a driver → their detail panel → **Reset Session**
  button, below the Edit/Remove row.

Both open a confirmation dialog before acting. No Flutter surface — this only affects sessions
on whatever device the driver was logged into; the driver app itself just needs to let them log
in again normally afterward, which it already does.
