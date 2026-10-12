# Part Truck (Shared-Capacity) Booking — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source, so there
are no file/line references here, only the backend contract and the UX the web apps
(`gadidosti-client`, `gadidosti-broker-driver`) now ship. Read
`TRUCK_TYPE_RETAXONOMY_FLUTTER_GUIDE.md` first if this app's truck-type picker still isn't wired
to `GET /api/config/vehicle-types` — everything below assumes it is.

**This replaces an earlier version of this doc** that had the client search for and target one
specific on-trip truck directly (`POST /api/trip-join-requests`, `GET
/vehicles/trucks/nearby-on-trip`). That design is gone — those endpoints no longer exist. If
anything in this app still calls them, it needs to be rebuilt against what's below instead.

## The idea in one paragraph

A driver opts their own truck into **Part Truck mode** — a toggle in their app, flippable any
time, including mid-trip. While it's on, that truck is eligible to be matched to a **second**,
smaller booking that shares its spare cargo capacity, on top of whatever it's already carrying
(idle, or already `on_trip` for a first client). The client's side of this is **not** a special
flow — picking "Part Truck" on the booking screen sends the exact same broadcast-and-negotiate
request as picking "Find Truck" for a normal booking (every available driver within radius gets
notified, first to respond wins, full counter-offer negotiation), just matched against a
narrower pool: drivers who've toggled Part Truck mode on. On accept, the client's booking gets
its own independent trip, running alongside the truck's original one if it has one.

## Client flow: identical to a normal Find Truck booking

1. **Location** — pickup/drop, same as any booking.
2. **Search** — pick "Part Truck" instead of a size (see below), tap through; the client's app
   shows the same "Finding you a nearby truck" waiting screen a normal Find Truck booking shows.
3. **Review** — same review/confirm screen as every other booking.
4. **Negotiation** — same accept / counter-offer / decline flow as every other booking
   (`driver_requests`, see below) — nothing part-load-specific here at all.
5. **Load** — same pickup OTP, trip tracking, POD flow as every other booking, once a driver
   accepts.

### How the client picks this mode

Truck selection is three **mutually exclusive** modes, not a size-grid card:
- **Full Truck** (default) — any size, picked from the normal truck-type grid, unchanged.
- **Part Truck** — shared capacity, no size grid at all (there's nothing to size-pick for it).
- **Book Later** — deliberately has no sub-type. A scheduled booking is always a full truck,
  never Part Truck; picking Book Later resets off Part Truck if it was active.

Picking Part Truck sets `truck_category: "part"` and, critically, `search_mode: "part_load"` on
`POST /api/bookings` (see below) — not `"truck"`. The size-grid step can be skipped entirely for
this mode, or kept visible-but-irrelevant; the web client keeps the step number the same and just
shows a locked "Part Truck selected" panel instead of the grid.

## Endpoints — all shared with the normal Find Truck flow

There are **no Part-Truck-specific booking/negotiation endpoints**. Every one of these is the
exact same endpoint a normal Find Truck booking already uses; `search_mode: "part_load"` on the
booking is the only thing that changes which drivers get matched. Base URL as established
elsewhere (`https://apigadidosti.asynk.in` or whatever this app already targets). Every response
is `{ success, message, data }`.

### 1. Create the booking — `POST /api/bookings`

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
`weight` is **required** for `search_mode: "part_load"` (422 without it) — the backend needs a
real number to run its capacity check. The backend broadcasts immediately on creation, same as a
normal Find Truck booking — there is no separate search step the client triggers afterward.

### 2/3/4. Wait for a driver, negotiate, confirm — the existing `driver_requests` flow

The booking creation above already fanned out to every driver currently in Part Truck mode within
range (whether idle or already `on_trip` with spare capacity). From here it's **identical to a
normal Find Truck booking**:

- Poll `GET /api/bookings/:id/driver-requests` — every live (non-declined) row is one responding
  driver, same as Find Truck's fan-out. Render each with `DriverOfferCard`-equivalent UI.
- Listen on the socket for `driver-request-created` / `driver-request-updated` (same events, same
  rooms, nothing part-load-specific).
- Accept / counter-offer / decline via `PATCH /api/driver-requests/:id/accept` |
  `/counter` | `/decline` — the exact same endpoints, same mutual-confirmation semantics, same
  negotiation rules as any other booking. There is nothing to build here that isn't already built
  for Find Truck.
- A `driver_requests` row returned from any of these now also carries `isPartLoad: true/false` —
  use it only for a small badge ("Part Truck" / shared-load indicator) on the offer card, nothing
  functional depends on it client-side.

If nothing matches within range, `PATCH /api/bookings/:id/rebroadcast` ("Search Again") works for
`search_mode: "part_load"` bookings too, same as it does for `"truck"` ones.

### 5. Driver/broker side — accept or decline

Same inbox as every other request: `GET /api/driver-requests?page=1&limit=20` (driver's own) /
the broker's timed-out-only equivalent. A Part Truck request shows up in this **same list**
alongside ordinary ones — there is no separate inbox anymore. Use each row's `isPartLoad` field to
flag it distinctly in the UI (e.g. "this is a SECOND load on top of your current trip" is worth
calling out, since unlike every other request here it can land while the driver already has an
active trip).

`PATCH /api/driver-requests/:id/accept` | `/counter` | `/decline` — same as above. Accept can
`409` if the match went stale between the request being sent and the driver tapping Accept
(another part-load request on the same truck won the race, or spare capacity changed) — show the
real error message, no special handling needed.

## The driver's Full Truck / Part Truck toggle

New, driver-facing settings — a simple on/off control, suggested placement: the driver dashboard,
near wherever the online/offline status toggle already lives.

### `PATCH /api/vehicles/drivers/me/truck-mode`
```json
{ "part_truck_mode": true }
```
Flips the driver's own assigned truck into (or out of) Part Truck mode. Flippable any time,
including mid-trip — turning it ON while already `on_trip` is exactly the "share my spare
capacity" case. Turning it OFF never touches a part-load booking already assigned; it only stops
the truck matching NEW ones. `409` if no truck is assigned yet. Response includes the updated
`truck` object and `capacityTonsSet: boolean` — a truck can toggle on without `capacity_tons` set,
it just then only ever matches while idle, never while already on a trip, until a broker/admin
sets one (see below).

### `PATCH /api/vehicles/drivers/me/accepting-loads`
```json
{ "accepting_loads": true }
```
A **second**, separate switch — only meaningful while `part_truck_mode` is on. Lets the driver
pause new Part Truck requests without fully exiting Part Truck mode, and without affecting a
booking already assigned. This is the driver's real "stop loading" control, since matching itself
has no hard count cap (see above) — a driver physically out of room taps this, not the mode
toggle. Suggested UI (matches the web driver app): a prominent full-width button, shown only
while Part Truck mode is on — "Mark Truck as Full" (sets `accepting_loads: false`) when currently
accepting, flipping to "Truck is Full — Tap to Accept More Loads" (sets it back to `true`) once
paused.

Both fields come back on the truck object from `GET /api/vehicles/drivers/me/truck` and anywhere
else a truck projection is returned: `partTruckMode: boolean`, `acceptingLoads: boolean`.

## A driver can now have several active trips at once

Once a Part Truck request is accepted, the driver's original trip and the new one run
**independently** — separate pickup OTPs, separate POD photos, separate payment collection,
separate statuses. Both existing behind the scenes, nothing conceptually new about either trip
individually; what's new is that a driver can have **more than one** of them active at the same
time. There's no hard cap on count — a truck keeps matching new Part Truck requests for as long
as it has real spare `capacity_tons` left (or until the driver pauses it with "Truck is Full",
see below), so a driver stacking several small loads on one trip is expected, not a bug.

### `GET /api/trips/active` returns a list

Response shape has an array alongside the existing single object:
```json
{ "trip": { "...": "the first one, for old clients" }, "trips": [ { "...": "trip 1" }, { "...": "trip 2" }, { "...": "trip 3" } ] }
```
`trip` is kept exactly as it always was (not a breaking change for any existing code), but a
driver with several active trips will have `trips.length` match that count. Build the driver's
"current trip" screen to read `trips` and, when there's more than one, show a picker (a
horizontally-scrollable tab row, not a fixed 2-up layout — the count is unbounded) that switches
which trip's detail view is showing. The detail view itself — status button, map, POD flow, stops
checklist — needs no changes; it already operates on whichever single trip object it's given.

`GET /api/trips/upcoming` is unaffected (still singular — "the next not-yet-started trip",
unrelated to this).

## Sandbox / testing notes

- A truck only becomes a Part Truck match candidate once its driver has toggled
  `part_truck_mode: true` **and** (if it's already `on_trip`) its broker/admin has set a numeric
  `capacity_tons` (a field distinct from the display-only `capacity` string, e.g. "18 Ton") with
  real spare capacity for the new booking's weight. An idle truck (`status = 'available'`) matches
  purely off the toggle — `capacity_tons` isn't checked for that branch.
- Spare capacity = `capacity_tons` minus the sum of weight on every booking currently assigned to
  that truck with status `assigned`/`en_route_pickup`/`picked_up`/`in_transit` (not `delivered` —
  that cargo's already off). No separate cap on booking count — a truck keeps matching as long as
  there's real spare capacity, until the driver pauses it (see below).
- No route-direction/bearing heuristic anymore — matching is purely radius + capacity + the
  driver's own toggle. The driver (or broker) decides for themselves, from what the request shows
  them, whether a pickup/drop is actually convenient — same judgment call they already make on an
  ordinary Find Truck request.
