# Loading/Unloading Stops — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. This feature (Ola/Uber-style "add a stop" — extra loading and
unloading points between the main pickup and drop) exists end-to-end on the backend and on both
web apps, but **`SSK_Cargo` has none of it** — confirmed by reading the actual source: zero
matches for `loading_location`/`unloading_location` anywhere under `lib/` (client side never
submits any), and the only match for `stops` anywhere near the driver's trip screen is an
unrelated `Gradient.stops` property, not `trip.stops` (driver side never reads/completes any).
Every citation below is real, read directly from the repo.

## The model, in one picture

A booking can optionally carry extra stops beyond pickup → drop:
`pickup → [loading stops...] → [unloading stops...] → drop`. Once a trip exists, this becomes an
ordered checklist (`trips.stops`) the driver checks off one at a time, in order, per type — the
coarse trip status can't advance past `in_transit` (if any loading stop is still pending) or into
`delivered` (if any unloading stop is still pending) until they're all done.

## Part 1 — Client: adding stops at booking time (currently missing entirely)

**Request shape** — `POST /api/bookings` already accepts, alongside the pickup/drop fields you
already send:
```json
{
  "add_loading_location": [{ "location": "Warehouse A, Pune", "lat": 18.52, "lng": 73.85 }],
  "add_unloading_location": [{ "location": "Depot B, Nashik", "lat": 19.99, "lng": 73.78 }]
}
```
Both are arrays, both optional, both default to none if omitted. `lat`/`lng` on each entry are
**also optional** at the validation layer (`gadidosti-backend/src/validations/booking.validation.js`,
lines 46–54) — this is deliberate (a stop can be typed as free text), but it comes with a real
trap the web client just got bitten by and fixed, described below. Build this the right way from
the start rather than repeating that bug.

**The trap, and how to avoid it**: `gadidosti-client`'s booking form (`src/pages/BookTruck.jsx`)
lets a user type a loading/unloading address into a `PlacesAutocompleteInput` and never actually
pick a suggestion — `lat`/`lng` stay `null` in that case. It used to **silently drop** any such
stop from the submitted booking entirely (no warning — the user believed they'd added a stop; it
never reached the backend). This was just fixed: before submit, it now geocodes any stop still
missing coordinates (reusing the same fallback pickup/drop already had), and if a stop still can't
be resolved after that, it blocks submission with a clear error instead of silently losing it.

For `SSK_Cargo`:
- Reuse the existing `GooglePlacesAutocompleteField` widget
  (`lib/features/client/presentation/widgets/google_places_autocomplete_field.dart`) for each
  loading/unloading stop input — it's already generic (not pickup/drop-specific), exposes
  `onSelected: ValueChanged<GooglePlaceSelection>` carrying `latitude`/`longitude` (lines 16–26,
  186–190), and is the same widget presumably already used for pickup/drop in
  `client_flow_widgets.dart`.
- Add an "Add Loading Point" / "Add Unloading Point" UI (a repeatable list, same idea as the web
  form's stop list) somewhere in the booking flow — likely near wherever pickup/drop are entered
  in `client_flow_widgets.dart`'s booking step widget.
- Track each stop's `location`/`lat`/`lng` in local state, and **only ever include a stop in the
  submitted payload once it has real coordinates** — either require a suggestion to be picked
  before the stop counts as "added" (simplest, avoids the whole trap), or add the same
  geocode-before-submit fallback the web client now has if you want to tolerate free-typed
  addresses. Either way, never silently drop a stop the user thinks they added — surface an error
  if one can't be resolved.
- Wire the resulting arrays into `_bookingPayload()` (`client_flow_widgets.dart`, ~line 3398) as
  `add_loading_location`/`add_unloading_location`. `createBooking()` in
  `lib/core/network/api_client.dart` (line 829) already passes the whole map straight through — no
  API-client changes needed, just add the keys at the call site.

## Part 2 — Driver: the mid-trip checklist (currently missing entirely)

Once a trip exists, `GET /api/trips/:id` / `GET /api/trips/active` (whatever
`DriverDeliveryDetailsScreen._loadTrip()` in
`lib/features/driver/presentation/screens/driver_delivery_details_screen.dart` already calls —
see its `trip` map, built at lines 149–158) includes a `stops` field:
```json
"stops": [
  { "type": "pickup",    "location": "...", "lat": 18.5, "lng": 73.8, "status": "pending" },
  { "type": "loading",   "location": "...", "lat": 18.52,"lng": 73.85,"status": "pending" },
  { "type": "unloading", "location": "...", "lat": 19.99,"lng": 73.78,"status": "pending" },
  { "type": "drop",      "location": "...", "lat": 20.0, "lng": 73.9, "status": "pending" }
]
```
`status` is `"pending"` or `"done"`. `stops` is always `[pickup, drop]` (2 entries, both
uncompletable via this mechanism — see below) for the vast majority of trips with no extra stops;
only render a checklist UI when a `loading`/`unloading` entry is actually present.

**Completing a stop**:
```
PATCH /api/trips/:id/stops/:index/complete      (driver, or the trip's own broker/admin — see
                                                   below)
→ 200 { trip: {...full trip, same shape as GET...} }
```
- `index` is the stop's position in the `stops` array (not a separate id).
- Only `loading`/`unloading` entries are ever completable this way — `pickup`/`drop` are
  completed via the normal coarse `PATCH /api/trips/:id/status` flow you already use, untouched.
- **Sequential within type**: only the earliest still-pending stop of a given type can be
  completed — completing stop 3 while stop 1 (same type) is still pending 409s with
  `"Complete the earlier {type} stops first"`. Mirror this client-side (only show/enable "Mark
  complete" on the earliest pending entry per type) rather than letting the user tap ahead and
  hit the error — same UX call the web driver app's `MyTrip.jsx` already makes (its own
  `nextActionableIndex(type)` helper).
- **Proximity**: for the driver's own call, this endpoint checks the driver's last-reported GPS
  (`trips.current_lat/lng`, kept fresh by whatever endpoint your location-tracking already PATCHes)
  against the stop's `lat`/`lng`, 409ing with a distance message if too far. If the stop itself has
  no `lat`/`lng` (Part 1's optional-coordinates case), this check is skipped entirely rather than
  permanently blocking the stop — a recent backend fix, since previously a stop with no
  coordinates could never be completed by anyone. You don't need to replicate the distance math
  client-side; just call the endpoint and surface whatever 409 message comes back.
- **Gate on the coarse status advance**: `PATCH /api/trips/:id/status` already 409s with
  `"Complete all loading stops before starting delivery."` (advancing to `in_transit`) or
  `"Complete all unloading stops before marking delivered."` (advancing to `delivered`) if any
  stop of that type is still pending. Disable/hide your own "advance" button while
  `stops.some(s => (s.type === 'loading' or 'unloading') && s.status !== 'done')` for the relevant
  type, so the driver isn't stopped by a raw error — but still handle the 409 gracefully as a
  fallback (e.g. a stale local copy of `stops`).

**Not driver-only anymore**: the trip's own broker, and any admin, can now also call this same
completion endpoint (and the coarse status endpoint, and POD upload) on the driver's behalf, for
when a driver is stuck/unreachable — this is a broker/admin-web-only feature for now
(`gadidosti-broker-driver`'s `JobDetail.jsx`, `gadidosti-admin-dashboard`'s `ViewBooking.jsx`), not
something `SSK_Cargo`'s driver-role screens need to change for. Only relevant here if `SSK_Cargo`'s
broker role ever grows an equivalent "take over this trip" screen — not part of this guide's scope.
