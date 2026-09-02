# Live Status Sync, Booking-Map Upgrades & Live Truck Path

Three related pieces of work, all landed on web (`gadidosti-client`, `gadidosti-broker-driver`).
No backend changes were needed — all three reuse infrastructure that already existed. This doc
also grounds what's still missing on the Flutter app (`SSK_Cargo`), checked against its actual
source, not guessed.

---

## 1. Closing the "still needs a reload" gaps

The `trip-status-updated` socket event (`docs/TRIP_STATUS_SOCKET_INTEGRATION.md`) already existed
and was already wired into the screens that matter most — `TrackShipment.jsx` (client tracking),
`MyTrip.jsx` (driver), `JobDetail.jsx` (broker job detail). Three screens were still fetch-once,
with no live update at all:

| Screen | App | Fix |
|---|---|---|
| `BookingDetail.jsx` | client | `loadBooking({ silent: true })` on any `trip-status-updated` whose `bookingId` matches the open booking |
| `MyBookings.jsx` | client | `loadBookings({ silent: true })` on any event (a list — cheap to just re-fetch the current page/filter) |
| `ActiveJobs.jsx` | broker | `load({ silent: true })` on any event |

All three fetch functions now take an optional `{ silent }` — skips `setLoading`/`setError` so a
background push never flashes a full loading state over content the user's already looking at
(same "silent refresh" pattern `JobDetail.jsx` already used). The socket hook itself
(`useTripStatusSocket`) was already shared infra — this was purely wiring it into three more
places, no new backend surface.

**Flutter — a real gap, not just "needs wiring."** Checked: only
`tracking_details_screen.dart` has a socket listener at all
(`grep 'trip-status-updated|socket\.on\(' lib/` → 2 hits, one of them the socket service itself).
`client_bookings_controller.dart` — the booking-list equivalent of `MyBookings.jsx` — has zero
socket/timer-based refresh (`grep 'socket|Socket|Timer\.periodic|listen\(' ` → no matches). This
needs the exact treatment `docs/TRIP_STATUS_SOCKET_INTEGRATION.md` §4 already describes generically
— add a `trip-status-updated` listener to whatever loads that controller's booking list, filter on
`bookingId`, and silently re-fetch. Same for whatever screen is the Flutter equivalent of
`BookingDetail.jsx` (a per-booking detail view, if one exists separately from the list).

---

## 2. Booking-creation map (Step 1 — `BookTruck.jsx`)

Three additions, all scoped to Step 1 only (they don't affect Steps 2-4 or the Step 3
truck-picker map, which is a separate component):

- **Live "you are here" blue dot** — `MapView.jsx` gained a `myLocation` prop, rendered as a
  small filled circle with a white ring (an inline SVG data URI, not Google's default pin) so it
  never reads as a route stop. `BookTruck.jsx` watches `navigator.geolocation.watchPosition` only
  while `step === 1` (cleared on `clearWatch` the moment the client leaves Step 1, so it's not
  burning GPS for the rest of the wizard).
- **Tap-to-pin** — `MapView.jsx` gained an `onMapClick` prop (wired to `GoogleMap`'s own
  `onClick`, cursor switches to a crosshair when active). `BookTruck.jsx` adds a small "Tap map
  to set: Pickup / Drop-off" pill selector above the address fields (`pinTarget` state,
  auto-advances from Pickup to Drop-off once Pickup is filled) plus a per-row crosshair button on
  every loading/unloading stop so those can be armed as the tap target too. A tap reverse-geocodes
  the point (same `Geocoder` call the existing "Use current location" button already used) into
  the target field.
- **Distance shown immediately** — previously "~X km" only appeared once a truck type was picked
  in Step 3 (it was gated behind `priceBreakdown`, which needs a pricing quote, which needs a
  truck category). Factored the existing straight-line chain-distance calculation (pickup → any
  loading stops → any unloading stops → drop) out into a standalone `chainDistanceKm()` helper,
  now also computed and shown directly under the Route summary the moment both pickup and drop
  have coordinates — no truck type needed. The Step-3-gated pricing effect reuses the same helper
  instead of duplicating the math.

**Flutter — this needs to be built, not adjusted.** Checked `client_flow_widgets.dart`, the
booking-creation flow's location-entry step: there is no `GoogleMap(` widget anywhere in it at
all (`grep 'GoogleMap\('` → zero hits in this file). It's a text/autocomplete-search-only step —
it does already have a `_useCurrentLocation()` handler (line 441) that mirrors the web app's old
"Use current location" button (reverse-geocode GPS into the address field), but no visual map, no
blue dot, no tap-to-pin. Matching web means adding an actual map to this step for the first time:

- A `GoogleMap` widget (the same `google_maps_flutter` package `tracking_route_map_view.dart`
  already uses elsewhere in this app, so the package is already a dependency) showing a live blue
  dot via `Geolocator.getPositionStream()`, scoped to just this step's lifecycle.
  `google_maps_flutter`'s own `myLocationEnabled: true` map option may cover the blue dot
  natively without a custom marker at all — worth trying first before building one by hand the
  way the web version had to (browsers have no equivalent built-in).
- An `onTap: (LatLng point) { ... }` callback on the `GoogleMap` reverse-geocoding the tapped
  point (`google_places_service.dart`, already used elsewhere in this codebase for routing, is
  the natural place to add a reverse-geocode call if it doesn't have one already) into whichever
  of pickup/drop/a stop is currently armed.
- A distance readout computed the same way — straight-line haversine across pickup → stops →
  drop — shown as soon as both ends have coordinates, not gated behind a truck-type pick later in
  the flow.

---

## 3. Live truck path while approaching pickup (`TrackShipment.jsx`)

Before this, the tracking map's drawn route only ever became "truck's real position → drop" once
the trip was `Picked Up`/`In Transit` (`POST_PICKUP_LABELS`). While the driver was still on the
way to pickup (`Assigned`/`En Route`), the truck marker moved around correctly but the drawn path
stayed a static pickup → drop line that never reflected where the truck actually was.

Fixed by adding `PRE_PICKUP_LABELS = ["Assigned", "En Route"]` and widening the existing
throttled `liveRouteOrigin` effect (already there for the post-pickup case, moved every ≥150m of
real movement — `ROUTE_ORIGIN_UPDATE_THRESHOLD_M`) to also apply pre-pickup. The route's
`destination` now switches to the pickup point during that phase (instead of drop), and since the
drop pin would otherwise vanish from view once it's no longer part of the drawn route, an explicit
green drop marker is now shown standalone during the pre-pickup phase so it stays visible for
context.

**Flutter — same underlying gap, but starting from a different baseline.** Checked
`tracking_route_map_view.dart`'s `_loadRoute()` (lines 210-228): it fetches a driving route
**always** `origin: pickup → destination: drop`, with no branch on trip status or the truck's live
position (`_livePoint`, already computed elsewhere in this same file from
`widget.shipment.liveLat/liveLng` and included in the marker set) at all. So this gap is actually
wider than web's was — the polyline here never reflects the truck's progress at *any* stage, pre-
or post-pickup, not just pre-pickup. Fix, mirroring the web logic above:

```dart
Future<void> _loadRoute() async {
  final live = _livePoint;
  final pickup = _pickupPoint;
  final drop = _dropPoint;
  final prePickup = ['assigned', 'en_route_pickup'].contains(widget.shipment.status);
  final origin = live ?? pickup;
  final destination = prePickup ? pickup : drop;
  if (origin == null || destination == null) { /* existing empty-state handling */ }
  final route = await _routesService.fetchDrivingRoute(
    originLatitude: origin.latitude, originLongitude: origin.longitude,
    destinationLatitude: destination.latitude, destinationLongitude: destination.longitude,
  );
  ...
}
```
(`widget.shipment.status` — confirm the exact field name on `TrackingDemoShipment`, this file's
model class, before wiring in; not verified here.) Re-run `_loadRoute()` on every live-location
update the same way it's presumably already re-run today when `_livePoint` changes, throttled the
same ~150m-of-movement way the web fix does, so the Directions API isn't re-queried on every
single location ping.

---

## 4. Quick checklist

| Item | Web | Flutter |
|---|---|---|
| Live status sync — booking list | Done (`MyBookings.jsx`) | Not started — `client_bookings_controller.dart` has no socket listener |
| Live status sync — booking detail | Done (`BookingDetail.jsx`) | Not checked for a dedicated detail screen — apply the same pattern if one exists |
| Live status sync — broker active jobs | Done (`ActiveJobs.jsx`) | N/A (broker is web-only) |
| Blue dot on booking-creation map | Done (`BookTruck.jsx` Step 1) | Not started — no map widget exists in this step at all yet |
| Tap-to-pin on booking-creation map | Done | Not started |
| Distance shown before truck-type pick | Done | Not started |
| Live truck path pre-pickup | Done (`TrackShipment.jsx`) | Not started — `_loadRoute()` is pickup→drop always, doesn't yet vary post-pickup either |
