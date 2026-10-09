# Part-Load (Shared-Truck) Booking — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. This is new — there is no existing part-load code in this app to
build on, unlike the other guides in this folder. Written without access to the current
`SSK_Cargo` source, so there are no file/line references here, only the backend contract and the
UX the web apps (`gadidosti-client`, `gadidosti-broker-driver`) now ship. Read
`TRUCK_TYPE_RETAXONOMY_FLUTTER_GUIDE.md` first if this app's truck-type picker still isn't wired
to `GET /api/config/vehicle-types` — everything below assumes it is.

## The idea in one paragraph

"Part Truck" used to be a label with no real matching behind it. Now it's real load-sharing: a
truck that's **already mid-delivery** for one client (`status = 'on_trip'`), with spare cargo
capacity, can pick up a **second** client's smaller load along the way. The client searches
on-trip trucks heading roughly the right direction with enough spare capacity, picks one, and
sends that truck's driver a request. The driver (or their broker, after a timeout) accepts or
declines — plain accept/decline, no negotiation. On accept, the client's booking gets its own
trip, running alongside the truck's original one; the driver now has two active trips on the same
truck/vehicle until both are delivered.

## How the client picks this mode

On the booking screen, truck selection is now three **mutually exclusive** modes, not a size-grid
card:
- **Full Truck** (default) — any size, picked from the normal truck-type grid, unchanged.
- **Part Truck** — shared capacity, no size grid at all (there's nothing to size-pick for it).
- **Book Later** — deliberately has no sub-type. A scheduled booking is always a full truck,
  never part-load; picking Book Later resets off Part Truck if it was active.

Picking Part Truck sets `truck_category: "part"` and, critically, `search_mode: "part_load"` on
`POST /api/bookings` (see below) — not `"truck"`. The size-grid step can be skipped entirely for
this mode, or kept visible-but-irrelevant; the web client keeps the step number the same and just
removes the Part Truck pill from the grid, which is the easiest version to replicate.

## Endpoints

All require a logged-in **client** (search + request) or **driver/broker** (accept/decline). Base
URL as established elsewhere (`https://apigadidosti.asynk.in` or whatever this app already
targets). Every response is `{ success, message, data }`.

### 1. Create the booking — `POST /api/bookings`

Same endpoint as every other booking, with two fields set specifically for this mode:
```json
{
  "truck_category": "part",
  "search_mode": "part_load",
  "pickup_location": "...", "pickup_lat": 19.07, "pickup_lng": 72.87,
  "drop_location": "...", "drop_lat": 18.52, "drop_lng": 73.85,
  "weight": 3, "weight_unit": "tons",
  "distance": 150
}
```
`search_mode: "part_load"` matters — it tells the backend to skip the normal broadcast entirely
(no truck is ever registered under category `'part'`, so a normal broadcast would silently match
nobody). The booking is created `pending`, with nothing happening automatically; the client
searches and requests a specific truck next.

### 2. Search for a truck to share — `GET /api/vehicles/trucks/nearby-on-trip`

```
?pickup_lat=19.07&pickup_lng=72.87&drop_lat=18.52&drop_lng=73.85&weight_tons=3&radius_km=50
```
All of `pickup_lat`/`pickup_lng`/`drop_lat`/`drop_lng`/`weight_tons` are **required** — unlike the
normal nearby-trucks search, there's a real capacity and route-direction check behind this one.
`radius_km` is optional (defaults to 50km).

```json
// response data.trucks[]
{
  "truckId": "...", "registration": "MH-08-AH-2727", "driverId": "...", "driverName": "...",
  "capacityTons": 10, "spareTons": 5.5,
  "distanceKm": 0.4, "etaMinutes": 1,
  "currentLat": 19.03, "currentLng": 72.85,
  "currentTripId": "...",
  "estimatedPrice": { "total": 2020.47, "...": "..." }
}
```
`currentTripId` is what you send back in step 3 — it identifies *which* of the driver's (possibly
two) trips this request is against. `estimatedPrice.total` is final — there's no negotiation in
v1, this is the price shown to the driver too.

A truck only ever appears here if its broker/admin has set a numeric `capacity_tons` on it (a
separate field from the display-only `capacity` string) — most existing trucks won't show up
until that's set, that's expected, not a bug.

### 3. Request that truck — `POST /api/trip-join-requests`

```json
{ "booking_id": "<the booking from step 1>", "target_trip_id": "<currentTripId from step 2>" }
```
Re-validates the match server-side before creating the request (`409` if the truck's capacity or
route changed in the meantime — re-search and pick again). Re-requesting after a decline on the
same booking is fine and expected (picking a different candidate, or retrying the same one) — the
backend resets the existing row rather than erroring.

```json
// response data.request
{
  "id": "...", "status": "pending",
  "bookingId": "...", "bookingNumber": "BKG-...",
  "truckId": "...", "truckReg": "...", "driverId": "...", "driverName": "...", "driverPhone": "...",
  "pickup": "...", "drop": "...", "weight": "3.00 tons", "amount": "2020.47",
  "driverTimedOut": false
}
```

### 4. Wait for the driver — poll + socket

Poll `GET /api/trip-join-requests/booking/:bookingId` (same shape as the create response above) —
this is also the **resume** endpoint: if the client navigates away and comes back, call this first
to find out whether a request already exists and what state it's in, instead of re-searching from
scratch. A `404` means no request exists yet for this booking — go back to step 2's search.

Also listen on the socket for `trip-join-request-updated`, pushed to the client the instant the
driver/broker acts — same event the driver's own request-created push listens for the other way,
`trip-join-request-created`, except that one's only relevant to the driver's side (see below).
Socket auth/connect is the same pattern this app already uses for `driver-request-updated` etc.

`data.status` drives the UI:
| `status` | Meaning | What to do |
|---|---|---|
| `"pending"` | Still waiting on the driver (or broker, once `driverTimedOut` flips true after 2 min) | Keep polling/listening |
| `"accepted"` | Done — a second, independent trip now exists for this booking | Show success, offer "Track Booking" |
| `"declined"` | This candidate said no | Go back to step 2's search, let the client pick another truck |

There's a two-stage timeout, same shape as the existing driver-request timeout: driver gets 2
minutes, then their broker gets a further 5 minutes, then the request auto-declines and the
client is notified to search again. Nothing extra to build for this — it's server-side, just
reflected in the `status` polling/push above.

### 5. Driver/broker side — accept or decline

`GET /api/trip-join-requests?page=1&limit=20` — a driver's own inbox (requests addressed to
them); for a broker, this same endpoint (role is read from the auth token) returns only requests
their drivers have already timed out on. Treat this as a **second, separate inbox** from the
existing `driver_requests` one — different table, different accept/decline endpoints, no
negotiation fields (`offerHistory` etc. don't exist here). The web app shows these as two tabs on
the same Requests screen rather than one merged list.

`PATCH /api/trip-join-requests/:id/accept` and `PATCH /api/trip-join-requests/:id/decline` — no
body needed for either. Accept can `409` if the match went stale between the request being sent
and the driver tapping Accept (another request took the last of the spare capacity) — show the
real error message, no special handling needed.

Push events for the driver/broker side: `trip-join-request-created` (a brand-new request just
landed, distinct from any later update) and `trip-join-request-updated` (status changed — mostly
relevant if the broker takes it over after a timeout).

## A driver can now have two active trips at once

Once a join request is accepted, the driver's original trip and the new part-load trip run
**independently** — separate pickup OTPs, separate POD photos, separate payment collection,
separate statuses. Both existing behind the scenes, nothing conceptually new about either trip
individually; what's new is that a driver can have **more than one** of them active at the same
time.

### `GET /api/trips/active` now returns a list

Response shape grew an array alongside the existing single object:
```json
{ "trip": { "...": "the first one, for old clients" }, "trips": [ { "...": "trip 1" }, { "...": "trip 2" } ] }
```
`trip` is kept exactly as it always was (so this is not a breaking change for any existing code),
but a driver with two active trips will have `trips.length === 2`. Build the driver's "current
trip" screen to read `trips` and, when there's more than one, show a simple picker (a couple of
tabs is enough — v1 caps a truck at 2 simultaneous bookings) that switches which trip's detail
view is showing. The detail view itself — status button, map, POD flow, stops checklist — needs
no changes; it already operates on whichever single trip object it's given.

`GET /api/trips/upcoming` is unaffected (still singular — it's "the next not-yet-started trip",
unrelated to this).

## Sandbox / testing notes

- A truck only becomes a part-load candidate once `capacity_tons` is set on it (broker/admin side,
  a numeric field distinct from the display `capacity` string) **and** it's actually `on_trip`
  with a driver who's reported a live location.
- Spare capacity = `capacity_tons` minus the sum of weight on every booking currently assigned to
  that truck with status `assigned`/`en_route_pickup`/`picked_up`/`in_transit` (not `delivered` —
  that cargo's already off).
- Route matching is a bearing + distance heuristic against the truck's current position and its
  own trip's remaining stop — not a real routing engine. A pickup very close to the truck is
  always fine; the drop point needs to be roughly the same direction and not much further than the
  truck's own destination.
