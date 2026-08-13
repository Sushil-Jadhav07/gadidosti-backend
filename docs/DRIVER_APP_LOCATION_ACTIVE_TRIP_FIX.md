# Fix: Driver location stops after accepting, trip status/Active tab don't update

Prompt for the Flutter app developer — concrete fix for the issue diagnosed in the previous
review of `d:\Clients\gaddidost\SSK_Cargo`: after both sides confirm (and payment is settled),
the driver's location stops being sent, trip status changes don't stick/show, and the trip
doesn't appear as active. This is a location-tracking lifecycle bug, not a payment or API-
contract bug — the backend endpoints and payloads are all correct.

## Root cause (confirmed by reading the actual source, not guessed)

`DriverShell` is the only place that starts/stops the location tracker
(`driver_shell.dart:44-53` calls `startTracking()`; `driver_shell.dart:72`'s `dispose()` calls
`stopTracking()`). But `DriverShell` only wraps three routes — `/driver/home`, `/driver/active`,
`/driver/earnings` (`app_router.dart:378-410`). Every trip-lifecycle screen —
`/driver/order-accepted`, `/driver/delivery-details/:tripId`, `/driver/delivery-proof/:tripId`,
`/driver/payment/:tripId` — is registered as a **top-level route, a sibling of the shell**, not
nested inside it.

The instant the driver accepts an offer and navigates to one of those screens, go_router tears
down `DriverShell` → `dispose()` fires → `stopTracking()` runs → the GPS stream is cancelled
**and `_activeTripId` is reset to `null`** (`driver_location_tracker.dart:100-106`). None of the
trip screens ever call `startTracking()` themselves, so from that point on:

- No location is sent at all while on those screens (or only a one-off `refreshCurrentLocation()`
  fires on specific button taps — `driver_delivery_details_screen.dart:237-239,657-659`).
- Even that one-off ping only sends `PATCH /api/vehicles/drivers/me/location` — the trip-scoped
  `PATCH /api/trips/{tripId}/location` branch inside `_sendPosition()`
  (`driver_location_tracker.dart:213-234`) is skipped every time, because it's gated on
  `_activeTripId` being non-null, and that was just reset to `null`.
- Server-side, `trips.current_lat/current_lng` never gets populated. This is also almost
  certainly why status transitions aren't "sticking" — the backend's pickup/delivered proximity
  gate (`trip.controller.js`) rejects `PATCH /api/trips/:id/status` with a 409 ("current location
  is not available yet") whenever it can't read a location for the trip, which will look exactly
  like "status isn't changing" from the UI if the error response isn't being surfaced clearly.
- `driver_delivery_details_screen.dart` also has no polling timer and no socket subscription —
  it only loads the trip once at `initState` and again after an explicit status-change action, so
  even fixing the above, the screen won't reflect a change until the user re-triggers something.

## The fix

### 1. Stop tying the location tracker's lifecycle to `DriverShell`

This is the actual bug — fix it at the source rather than patching every trip screen
individually. The reference web app (`gadidosti-broker-driver`) starts its equivalent tracker
**once, at the app root** (`App.jsx`, outside any specific route), so navigating between pages
never tears it down — it only stops on logout.

Do the same here:
- Move the `ref.read(driverLocationTrackerProvider).startTracking()` call out of
  `DriverShell.initState` and into whatever widget wraps the **entire** driver section of the
  app (all routes, both inside and outside the current shell) — ideally something that mounts
  once when the driver logs in and doesn't unmount again until logout. If no such top-level
  driver-scoped widget currently exists, this is the right time to add one, or move the call up
  to wherever the driver's authenticated app shell/root is constructed.
- Remove the `stopTracking()` call from `DriverShell.dispose()` entirely — that's what's
  actively breaking this. Only call `stopTracking()` from an explicit logout action.

### 2. Make `_activeTripId` survive navigation the same way

Once tracking isn't tied to `DriverShell`'s lifecycle, `_activeTripId` also needs to stop being
reset by it. Set it (`driverLocationTrackerProvider`'s `setActiveTripId(tripId)` — whatever the
actual method is called) as soon as a trip id resolves in `driver_order_accepted_screen.dart`'s
handoff logic (right where it currently navigates to `/driver/delivery-details/:tripId`), and
clear it only when the trip reaches a genuinely terminal state (`completed`/`cancelled`) — not on
every screen unmount.

### 3. Add live updates to `driver_delivery_details_screen.dart` ("My Trip")

Right now it only loads once at `initState` plus after explicit actions. Add either:
- A poll timer (`Timer.periodic`, ~10-15s) calling `GET /api/trips/{tripId}` while this screen
  is mounted, same pattern the reference web driver app uses as a fallback, **or**
- A subscription to the app's existing socket service for trip-relevant events — note the socket
  service already correctly listens for `driver-request-updated`/`booking-payment-updated`
  (confirmed in the earlier review), but there's currently no live socket event for trip status
  changes at all (documented in `DRIVER_TRIP_FLOW_GUIDE.md` §6 — this is poll-only by design on
  the backend side), so the poll timer is the actually-correct fix here, not a missing socket
  listener.

### 4. Re-verify the "Active" tab picks the trip up

`driver_rider_screen.dart` (`/driver/active`, inside the shell) should start showing the trip
again once #1-#2 are fixed and a `GET /api/trips/active` call succeeds. Confirm it actually
re-fetches when the driver navigates back to this tab (e.g. via a route-aware refresh or
`didPopNext`), not just once at first mount — if it's relying on cached provider state from
before the trip existed, it may need an explicit refresh call added for when this tab regains
focus.

## Verification checklist after the fix

1. Accept an offer as the driver, confirm both sides (client + driver), and complete/skip
   payment — the driver should navigate to `/driver/delivery-details/:tripId`.
2. Confirm `PATCH /api/trips/{tripId}/location` calls are actually firing periodically while on
   that screen (log them, or check the network tab) — not just the device-level
   `.../drivers/me/location` call.
3. Tap "Start Trip to Pickup" (`en_route_pickup`) and confirm it succeeds without a 409 about
   missing location.
4. Navigate to `/driver/active` — the trip should show there without needing to force-quit/
   restart the app.
5. Physically move (or mock GPS) and confirm the trip screen's map marker actually updates
   without the driver tapping anything.
