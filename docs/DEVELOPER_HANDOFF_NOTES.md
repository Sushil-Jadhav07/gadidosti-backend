# GadiDost — Developer Handoff Notes

This document covers everything built across a series of sessions on this codebase: the
driver/broker negotiation flow, real-time push, trip lifecycle + multi-stop bookings, GPS
tracking, invoicing, and the related UI work across all four apps. It's written for a
developer picking this codebase up — every endpoint, its **full request body and response
body**, and which frontend file calls it.

**Verified against the live source** (not written from memory) — every field name and
response shape below was pulled directly from the current controllers
(`projectX(...)` functions) and route files' request-validation schemas as of this write-up,
and cross-checked against everything built this session. No gaps found between what was
built and what's documented.

**Repos referenced:**
- `gadidosti-backend` — Node/Express/PostgreSQL API
- `gadidosti-client` — React client (customer-facing booking app)
- `gadidosti-broker-driver` — React app, two roles in one codebase (broker + driver)
- `gadidosti-admin-dashboard` — React admin dashboard

All responses follow one envelope shape unless noted otherwise (streamed files like the
invoice PDF are the only exception):
```json
{ "success": true, "message": "...", "data": { /* shown per-endpoint below */ } }
{ "success": false, "message": "...", "errors": [ /* only present on 422 validation errors */ ] }
```
Every request needs `Authorization: Bearer <access_token>` unless stated otherwise.

---

## 1. Negotiation flow (driver ↔ broker ↔ client)

Two independent entry points into the same negotiation machinery (`driver_requests` table),
both converging on the same accept/decline/counter endpoints and the same trip-creation logic.

### 1a. Direct client-pick (client picks a specific truck)

1. `GET /api/vehicles/trucks/nearby` — browse trucks near pickup.
2. `POST /api/bookings/{id}/request-truck` — creates a `driver_requests` row at the booking's current price.
3. **Driver's 2-minute window** — accept/decline/counter.
4. No response in 2 min → cron (`sweep()`, every minute) hands it to the broker.
5. No response in 5 min total → cron (`brokerSweep()`) expires it; falls back to broker-broadcast (1b), already running in parallel.
6. Client finalizes via client-accept / client-reject / client-counter.

### 1b. Broker-broadcast (no specific truck picked)

1. `POST /api/bookings` fans the booking out as `job_requests` to every eligible broker.
2. Broker sees it via `GET /api/jobs/requests`, can decline/counter.
3. Client picks a winner via `PATCH /api/jobs/requests/{id}/client-accept`.
4. Broker calls `POST /api/jobs/{id}/assign-driver` — **creates a `driver_requests` row** (this
   session's fix — previously locked the driver in instantly, zero negotiation window). Same
   2-min → 5-min escalation as 1a.

### Finalization (shared)

`finalizeDriverRequest()` in `driverRequest.controller.js`: booking → `assigned`; every stale
`job_requests` row for the booking set to `declined` (this session's fix for phantom
"pending forever" rows in other brokers' inboxes); `trips` row created with the `stops` array
(§3); both driver and broker notified.

---

### Endpoint reference — negotiation

#### `POST /api/bookings/{id}/request-truck`
**Auth:** client
**Request body:**
```json
{ "truck_id": "uuid (required)" }
```
**Response 201** — `data`:
```json
{ "request": { /* driver_requests shape, see below */ } }
```
**Errors:** 403 not your booking · 404 booking/truck not found · 409 booking no longer pending / truck not available / truck has no driver.

#### `POST /api/jobs/{id}/assign-driver`
**Auth:** broker
**Request body:**
```json
{ "driverId": "uuid (required)", "truckId": "uuid (required)" }
```
**Response 200 — first assignment** (creates the negotiation window):
```json
{ "request": { /* driver_requests shape */ } }
```
message: `"Driver offer sent — awaiting response"`

**Response 200 — reassignment** (driver swap on an already-active trip, no negotiation window):
```json
{
  "booking": {
    "id": "uuid", "status": "en_route_pickup", "brokerId": "uuid", "driverId": "uuid",
    "truckId": "uuid", "pickup": "...", "drop": "...",
    "timeline": ["pending", "confirmed", "assigned", "..."], "currentStep": 3
  }
}
```
**Errors:** 403 not your job request · 404 job request/booking/driver/truck not found · 409 job request not accepted yet, or truck not available · 422 driverId/truckId missing or not a UUID.

#### `GET /api/driver-requests`
**Auth:** driver, broker · query: `page`, `limit` (max 100)
**Response 200:**
```json
{ "requests": [ /* driver_requests shape */ ], "total": 0, "page": 1, "limit": 10, "total_pages": 0 }
```

#### `GET /api/driver-requests/{id}` / `GET /api/driver-requests/booking/{bookingId}`
**Auth:** client/driver/broker (party to it) or admin
**Response 200:** `{ "request": { /* driver_requests shape */ } }`
**Errors:** 403 no access · 404 not found

#### `PATCH /api/driver-requests/{id}/accept`
**Auth:** driver (while open) → broker (after 2-min timeout)
**Request body:** none
**Response 200:** `{ "request": { /* driver_requests shape, status now "accepted", booking finalized */ } }` — message `"Accepted — booking confirmed"`
**Errors:** 400 not awaiting your response · 403 not yours to respond to · 409 booking no longer available (race lost)

#### `PATCH /api/driver-requests/{id}/decline`
**Auth:** driver → broker
**Response 200:** `{ "request": { ... } }` — message `"Declined"`

#### `PATCH /api/driver-requests/{id}/counter`
**Auth:** driver → broker
**Request body:** `{ "amount": "number (required)", "note": "string (optional)" }`
**Response 200:** `{ "request": { ... } }`

#### `PATCH /api/driver-requests/{id}/client-accept`
**Auth:** client
**Response 200:** `{ "request": { ..., "status": "accepted" } }` — message `"Booking confirmed"` — **finalizes, creates the trip**
**Errors:** 400 not awaiting your response · 403 not your booking · 409 booking no longer available

#### `PATCH /api/driver-requests/{id}/client-reject`
**Auth:** client
**Response 200:** `{ "request": { ... } }` — booking stays `pending`

#### `PATCH /api/driver-requests/{id}/client-counter`
**Auth:** client
**Request body:** `{ "amount": "number (required)", "note": "string (optional)" }`
**Response 200:** `{ "request": { ... } }` — resets `driverTimedOut` to false

**`driver_requests` response shape** (`projectDriverRequest`), used by every endpoint above:
```json
{
  "id": "uuid", "bookingId": "uuid", "bookingNumber": "BKG-202608-001",
  "clientName": "...", "clientPhone": "...",
  "driverId": "uuid", "driverName": "...", "driverPhone": "...",
  "brokerId": "uuid", "brokerName": "...", "brokerPhone": "...",
  "truckId": "uuid", "truckReg": "MH12AB1234", "truckType": "Medium Truck", "truckCategory": "medium",
  "pickup": "...", "drop": "...", "weight": "5 tons",
  "amount": 4500, "status": "pending",
  "jobRequestId": null,
  "driverTimedOut": false,
  "offerHistory": [ { "by": "driver", "amount": 4200, "note": null, "at": "2026-08-10T10:00:00Z" } ],
  "createdAt": "...", "updatedAt": "..."
}
```
`status` ∈ `pending | countered | accepted | declined | expired`. `jobRequestId` non-null only
for the broker-assign origin. Whose turn it is: `status="pending" && !driverTimedOut` → driver;
`status="pending" && driverTimedOut` → broker; `status="countered"` → client.

---

#### `GET /api/jobs/requests`
**Auth:** broker · query: `page`, `limit`
**Response 200:**
```json
{ "requests": [ { /* job_request shape below */ } ], "total": 0, "page": 1, "limit": 10, "total_pages": 0 }
```
**`job_request` shape** (`projectJobRequest`):
```json
{
  "id": "uuid", "bookingId": "uuid", "bookingNumber": "...",
  "clientName": "...", "clientPhone": "...", "brokerName": "...", "brokerPhone": "...",
  "pickup": "...", "drop": "...", "distance": 12.4, "truckType": "Medium Truck",
  "weight": "5 tons", "amount": 4500, "status": "pending",
  "offerHistory": [ { "by": "client", "amount": 4500, "note": null, "at": "..." } ],
  "timestamp": "2 min ago"
}
```
`status` ∈ `pending | countered | accepted | declined`.

#### `PATCH /api/jobs/requests/{id}/decline`
**Auth:** broker
**Response 200:** `{ "request": { /* raw job_requests row — NOT run through projectJobRequest, snake_case columns */ } }`
**Errors:** 400 already actioned

#### `PATCH /api/jobs/requests/{id}/counter`
**Auth:** broker
**Request body:** `{ "amount": "number, min 1 (required)", "note": "string (optional)" }`
**Response 200:** `{ "request": { /* job_request shape */ } }`
**Errors:** 400 not awaiting broker's response / already actioned

#### `PATCH /api/jobs/requests/{id}/client-accept`
**Auth:** client
**Response 200:**
```json
{ "booking": { "id": "uuid", "status": "confirmed", "brokerId": "uuid", "amount": 4500 } }
```
**Errors:** 400 not awaiting your response / race lost · 403 not your booking · 404 not found · 409 booking no longer available

#### `PATCH /api/jobs/requests/{id}/client-reject`
**Auth:** client
**Response 200:** `{ "request": { /* raw job_requests row */ } }`

#### `PATCH /api/jobs/requests/{id}/client-counter`
**Auth:** client
**Request body:** `{ "amount": "number, min 1 (required)", "note": "string (optional)" }`
**Response 200:** `{ "request": { /* job_request shape */ } }`
**Errors:** 400 not awaiting response · 403 not your booking · 404 not found · 422 validation

**Frontend:**
- `gadidosti-client/src/pages/RequestDriver.jsx` (direct-pick), `ChooseBroker.jsx` (broadcast), both driven from `BookTruck.jsx`.
- `gadidosti-client/src/pages/MyBookings.jsx`'s `DriverRequestPanel`.
- `gadidosti-broker-driver/src/pages/driver/Requests.jsx`, `src/pages/broker/DriverRequests.jsx`, `src/pages/broker/JobRequests.jsx`.

---

## 2. Real-time push (Socket.IO)

`src/realtime/socket.js`. Every authenticated socket auto-joins `user:{userId}` on connect.
Opt-in rooms: `thread:{chatThreadId}` (chat), `truck:{truckId}` (live GPS while browsing
nearby trucks).

**Event `driver-request-updated`** — payload is exactly the `driver_requests` shape above.
Emitted from every accept/decline/counter/client-* handler plus both cron sweeps, straight to
the relevant party's `user:{id}` room. Polling remains as a fallback everywhere (interval
lengthened once sockets were added, never removed).

Hook: `useDriverRequestSocket.js` in each app, wraps `socket.io-client` with
`{ auth: { token }, transports: ["websocket","polling"] }`.

---

## 3. Trip lifecycle, statuses, proximity gating, multi-stop

### Status enum (`booking_status`)
`pending → confirmed → assigned → en_route_pickup → picked_up → in_transit → delivered → completed`
(plus `cancelled`, `no_broker_available`).

### Driver action flow (`MyTrip.jsx`)

| Button | Transition | Endpoint |
|---|---|---|
| Start Trip to Pickup | `confirmed → en_route_pickup` | `PATCH /api/trips/{id}/status` |
| I've Reached Pickup | `en_route_pickup → picked_up` | same, proximity-gated |
| Start Delivery | `picked_up → in_transit` | same, blocked if a loading stop is pending |
| Mark as Delivered | `in_transit → delivered` | same, proximity-gated + blocked if an unloading stop is pending |
| Upload Proof of Delivery | `delivered → completed` | `POST /api/trips/{id}/pod`, then status PATCH |

### `GET /api/trips`
**Auth:** broker/driver (own only) or admin (all) · query: `status`, `truckId`, `driverId` (broker/admin only), `page`, `limit`
**Response 200:** `{ "trips": [ { /* trip shape below */ } ], "total", "page", "limit", "total_pages" }`

### `GET /api/trips/active` / `GET /api/trips/upcoming`
**Auth:** driver
**Response 200:** `{ "trip": { /* trip shape */ } }` or `{ "trip": null }`

### `GET /api/trips/{id}`
**Auth:** broker/driver/admin (own trip only for broker/driver)
**Response 200:** `{ "trip": { /* trip shape */ } }`
**Errors:** 403 no access · 404 not found

**Trip response shape** (`projectTrip`, used by every trip endpoint above):
```json
{
  "id": "uuid", "bookingId": "uuid", "bookingNumber": "...", "status": "in_transit",
  "broker": "...", "brokerPhone": "...", "driverId": "uuid", "driverName": "...", "driverPhone": "...",
  "clientName": "...", "clientPhone": "...", "truckId": "uuid", "truckReg": "...",
  "pickup": { "location": "...", "address": "...", "contactPerson": "...", "contactPhone": "...", "time": "...", "lat": 19.07, "lng": 72.87 },
  "drop":   { "location": "...", "address": "...", "contactPerson": "...", "contactPhone": "...", "time": "...", "lat": 18.52, "lng": 73.85 },
  "distance": 12.4, "estimatedTime": "45 min",
  "stops": [
    { "type": "pickup",    "location": "...", "lat": 0, "lng": 0, "status": "done",    "completedAt": "..." },
    { "type": "loading",   "location": "...", "lat": 0, "lng": 0, "status": "pending", "completedAt": null },
    { "type": "unloading", "location": "...", "lat": 0, "lng": 0, "status": "pending", "completedAt": null },
    { "type": "drop",      "location": "...", "lat": 0, "lng": 0, "status": "pending", "completedAt": null }
  ],
  "cargo": { "material": "...", "weight": 5, "quantity": 2, "specialInstructions": "...", "value": 4500 },
  "earnings": 4350, "startedAt": "...", "deliveredAt": null, "timeTakenMinutes": null,
  "currentLocation": { "lat": 19.08, "lng": 72.88 },
  "distanceRemainingKm": 3.2, "etaMinutes": 5,
  "podUrl": null, "podPhotos": [],
  "paymentStatus": "pending", "amountToCollect": 4500, "driverQrUrl": null,
  "timeline": [ { "step": "confirmed", "done": true, "time": "..." } ],
  "createdAt": "...", "updatedAt": "..."
}
```
`stops` is `[pickup, drop]` (2 entries) for every trip with no extra loading/unloading points —
zero behavior change for the common case. `distanceRemainingKm`/`etaMinutes` are `null` unless
status is `en_route_pickup` (→ target pickup) or `picked_up`/`in_transit` (→ target drop) *and*
a live position is known.

### `PATCH /api/trips/{id}/status`
**Auth:** broker, driver, admin · header: `Idempotency-Key` (optional)
**Request body:** `{ "status": "confirmed|en_route_pickup|picked_up|in_transit|delivered|completed|cancelled" }`
**Response 200:** `{ "trip": { /* trip shape */ } }`
**Errors:** 409 too far from pickup/drop (driver only, includes exact distance in the message) · 409 pending loading/unloading stops · 403 no access · 404 not found

### `PATCH /api/trips/{id}/stops/{index}/complete`
**Auth:** driver only
**Request body:** none
**Response 200:** `{ "trip": { /* trip shape, that stop now status:"done" */ } }` — message `"Stop completed"`
**Errors:** 404 trip/stop not found · 422 index points at a pickup/drop entry · 409 already done / earlier same-type stop still pending / too far (with distance) / no current location yet

### `POST /api/trips/{id}/decline`
**Auth:** driver · only while trip status is `confirmed`
**Response 200:** message `"Trip declined"`, no `data`
**Errors:** 409 trip already started

### `PATCH /api/trips/{id}/location`
**Auth:** driver
**Request body:** `{ "lat": "number (required)", "lng": "number (required)" }`
**Response 200:** `{ "currentLocation": { "lat": 19.08, "lng": 72.88 } }`

### `POST /api/trips/{id}/report-issue`
**Auth:** driver · only while trip is active
**Request body:** `{ "reason": "accident|breakdown|traffic_block|medical|other (required)", "notes": "string (optional, nullable)" }`
**Response 201:** `{ "incident": { /* incident shape below */ } }`
**Errors:** 403 not your trip · 409 trip not active

### `GET /api/trips/{id}/incidents`
**Auth:** trip's broker/driver/client/admin
**Response 200:** `{ "incidents": [ { /* incident shape */ } ] }`

**Incident shape** (`projectIncident`):
```json
{
  "id": "uuid", "tripId": "uuid", "driverId": "uuid", "reason": "breakdown",
  "notes": "...", "status": "reported", "reportedAt": "...", "resolvedAt": null, "resolution": null,
  "mechanicRequest": { "id": "uuid", "status": "requested", "mechanicName": null, "mechanicPhone": null, "notes": null, "updatedAt": "..." }
}
```
`mechanicRequest` is `null` unless `reason === "breakdown"`.

### `PATCH /api/trips/{id}/incidents/{incidentId}/resolve`
**Auth:** broker (own trip) or admin
**Request body:** `{ "resolution": "string (required)" }`
**Response 200:** `{ "incident": { ... } }`
**Errors:** 404 not found · 409 already resolved

### `PATCH /api/trips/{id}/incidents/{incidentId}/mechanic`
**Auth:** broker (own trip) or admin
**Request body:**
```json
{
  "status": "requested|mechanic_assigned|in_progress|resolved (optional)",
  "mechanicName": "string (optional, nullable)",
  "mechanicPhone": "string (optional, nullable)",
  "notes": "string (optional, nullable)"
}
```
**Response 200:** `{ "incident": { ... } }`
**Errors:** 400 incident has no linked mechanic request (not a breakdown) · 404 not found

### `POST /api/trips/{id}/pod`
**Auth:** driver, own trip · only while `in_transit` or `delivered`
**Request body:** `multipart/form-data`, field `files` — up to 6 photos total per trip
**Response 200:** `{ "podPhotos": [ "https://.../pod1.jpg", "..." ] }` — every photo uploaded so far, not just this call's
**Errors:** 403 not your trip · 409 wrong status · 422 no files / exceeds 6-photo cap

### `PATCH /api/trips/{id}/collect-payment`
**Auth:** driver, own trip · only while linked booking's `payment_status` is `pending`
**Request body:** `{ "mode": "upi|cash (required)" }`
**Response 200:** `{ "paymentStatus": "paid", "paymentMode": "upi" }`
**Errors:** 403 not your trip · 409 already paid

### `GET /api/trips/pod/file/{id}`
**Auth:** anyone who can view the trip · only relevant when `STORAGE_PROVIDER=postgres`
**Response 200:** raw file bytes (`Content-Type` from storage)

### Multi-stop bookings (Ola/Uber-style "add stop")

`bookings.loading_locations` / `bookings.unloading_locations` (JSONB arrays of
`{location, lat, lng}`) are set via `add_loading_location` / `add_unloading_location` in the
`POST /api/bookings` body (§4). At trip creation these flatten into the ordered `trips.stops`
array shown above. `PATCH .../stops/{index}/complete` only ever targets `loading`/`unloading`
entries — pickup/drop stay on the normal status PATCH. Rules: proximity-gated (same 800m),
sequential within type, and `updateTripStatus` itself 409s if you try to skip ahead.

**Frontend:**
- `gadidosti-client/src/pages/BookTruck.jsx` — add-stop UI, client-side leg-summed distance.
- `gadidosti-broker-driver/src/pages/driver/MyTrip.jsx` — stop checklist (rendered only when `stops` has loading/unloading entries).
- `gadidosti-broker-driver/src/pages/broker/JobDetail.jsx` — read-only checklist + live map.

### Location push summary

- `PATCH /api/vehicles/drivers/me/location` — driver's global live position (`driver_profiles.current_lat/lng`).
- `PATCH /api/trips/{id}/location` — trip-scoped, drives proximity gating + client's live map. Stops the moment the trip leaves "active" (delivered/completed/cancelled) → `trips.current_lat/lng` freezes at the real delivery point.
- `GET /api/bookings/{id}/track` — see §4, fixed this session to read the frozen trip position once terminal instead of the driver's now-unrelated live position.

---

## 4. Bookings — creation, pricing, tracking

### `POST /api/bookings/validate-location`
**Auth:** client
**Request body (all optional):**
```json
{ "pickup_location": "string", "drop_location": "string", "transport_type": "intra|inter", "city": "string" }
```
**Response 200:** `{ "valid": true }`
**Errors:** 422 city missing for intra-city / locations not within the given city

### `POST /api/bookings/quote`
**Auth:** any authenticated role
**Request body:**
```json
{
  "truck_category": "small|medium|large|part (required)",
  "transport_type": "intra|inter (default intra)",
  "distance": "number, km (required)",
  "capacity_used_pct": "number (only used when truck_category=part)",
  "duration_min": "number (optional) — enables traffic surge with duration_in_traffic_min",
  "duration_in_traffic_min": "number (optional)"
}
```
**Response 200** — `data` **is the breakdown itself** (not nested under a key), shape depends on `truck_category`/`transport_type`:
```json
// intra-city (small/medium/large)
{ "baseFare": 300, "distance": 12.4, "distanceFare": 620, "subtotal": 920, "trafficMultiplier": 1.15, "trafficSurcharge": 138, "platformFee": 105.8, "total": 1163.8 }
// part-load (truck_category="part")
{ "totalTruckCost": 800, "capacityUsedPct": 40, "trafficMultiplier": 1.0, "trafficSurcharge": 0, "platformFee": 80, "total": 880, "distance": 12.4 }
```
**Errors:** 404 pricing config not found · 422 validation

### `POST /api/bookings`
**Auth:** client · header: `Idempotency-Key` (optional)
**Request body (nothing required — see description):**
```json
{
  "pickup_location": "string", "pickup_lat": 0, "pickup_lng": 0,
  "drop_location": "string", "drop_lat": 0, "drop_lng": 0,
  "transport_type": "intra|inter (default intra)", "city": "string",
  "add_loading_location": [ { "location": "string", "lat": 0, "lng": 0 } ],
  "add_unloading_location": [ { "location": "string", "lat": 0, "lng": 0 } ],
  "truck_type": "string", "truck_category": "small|medium|large|part",
  "weight": 0, "weight_unit": "tons", "quantity": 0, "material": "string", "notes": "string",
  "scheduled_date": "ISO date-time",
  "distance": 0, "duration_min": 0, "duration_in_traffic_min": 0,
  "amount": 0, "payment_status": "paid|pending (default pending)"
}
```
**Response 201:** `{ "booking": { /* booking shape below */ } }`
**Errors:** 422 invalid (not missing) transport_type/lat/lng/array shape, or locations outside the given city

### `GET /api/bookings`
**Auth:** any role (auto-scoped) · query: `status` (comma-separated), `sort`, `page`, `limit`
**Response 200:** `{ "bookings": [ { ... } ], "total", "page", "limit", "total_pages" }`

### `GET /api/bookings/{id}`
**Auth:** party to it or admin
**Response 200:** `{ "booking": { /* booking shape */ } }`

**Booking response shape** (`projectBooking`):
```json
{
  "id": "uuid", "bookingNumber": "BKG-202608-001", "clientId": "uuid", "brokerId": "uuid",
  "driverId": "uuid", "truckId": "uuid", "status": "in_transit",
  "pickup": "...", "pickupLat": 19.07, "pickupLng": 72.87, "drop": "...", "dropLat": 18.52, "dropLng": 73.85,
  "city": null,
  "loadingLocations": [ { "location": "...", "lat": 0, "lng": 0 } ],
  "unloadingLocations": [],
  "truckType": "Medium Truck", "truckCategory": "medium",
  "weight": 5, "weightUnit": "tons", "quantity": 2, "material": "...", "notes": null,
  "transportType": "inter", "date": "...", "amount": 4500,
  "paymentStatus": "pending", "paymentMode": null, "paidAt": null,
  "driver": { "name": "...", "phone": "..." }, "truckReg": "...", "broker": "...",
  "timeline": ["pending", "confirmed", "assigned", "..."], "currentStep": 4,
  "pricing": { /* the breakdown object stored at creation */ },
  "distance": 12.4, "platformFee": 105.8, "podUrl": null, "rating": null,
  "currentLat": 19.08, "currentLng": 72.88,
  "stops": [ { "type": "pickup", "...": "..." } ],
  "timeTakenMinutes": null,
  "createdAt": "...", "updatedAt": "..."
}
```
Broker/admin only also get: `client`, `clientPhone`, `clientEmail`.
Admin only also gets: `driverPhone`, `brokerPhone`, `deletedAt`, `deletedBy`.

### `GET /api/bookings/{id}/track`
**Auth:** party to it or admin · polled every 5-10s by the frontend
**Response 200:**
```json
{
  "status": "in_transit",
  "driverLat": 19.08, "driverLng": 72.88, "lastLocationAt": "...",
  "isTerminal": false, "deliveredAt": null,
  "distanceRemainingKm": 3.2, "etaMinutes": 5,
  "incident": { "reason": "breakdown", "notes": "...", "status": "reported", "reportedAt": "...", "mechanicStatus": "requested" }
}
```
Once `status` is `delivered`/`completed`: `isTerminal: true`, `driverLat/Lng` are the **frozen
trip position at delivery** (not the driver's current live position), `distanceRemainingKm`/
`etaMinutes` are `null`, `deliveredAt` is set. `incident` is `null` when there's no unresolved
one.

### `DELETE /api/bookings/{id}`
**Auth:** admin (hard delete, any status) · broker/broker-less-driver (soft hide, only `pending|cancelled|completed`)
**Response 200:** message only, no `data`
**Errors:** 403 not your booking · 404 not found · 409 already deleted / status doesn't allow it

**Frontend:** `gadidosti-client/src/pages/BookTruck.jsx`, `TrackShipment.jsx`, `MyBookings.jsx`.

---

## 5. Third-party GPS tracking (Bolt / Roadcast) — admin only

⚠️ **Current vendor credentials are rejected** ("User not found") — app owner needs to follow
up with Roadcast. Everything below works once fixed.

### `GET /api/tracking/devices`
**Auth:** admin only
**Response 200 (live):** `{ "devices": [ { /* device shape below */ } ] }`
**Response 200 (vendor call failed, cache available):** `{ "devices": [ { ... } ], "source": "cached" }` — each device also carries `source:"cached"` and `lastSeenAt`
**Errors:** 502 vendor unreachable and no cache available

### `GET /api/tracking/devices/name/{name}` / `GET /api/tracking/devices/imei/{imei}`
**Auth:** any authenticated role
**Response 200:** `{ "device": { /* device shape */ } }` (or the cached variant, `source:"cached"`)
**Errors:** 404 not found (live or cached)

**Device shape** (live, from the Bolt vendor — field names per `TrackingDetail.jsx`'s known fields):
```json
{
  "deviceId": "...", "name": "...", "deviceImei": "...", "type": "...", "phone": "...",
  "latitude": 19.08, "longitude": 72.88, "speed": 42, "course": 180,
  "totalDistance": 1234.5, "ignition": true, "alarm": null,
  "deviceFixTime": "...", "lastUpdate": "...", "status": "online"
}
```
**Cached variant** (`tracking_last_known` table, upserted on every successful live fetch):
```json
{
  "deviceImei": "...", "name": "...", "latitude": 19.08, "longitude": 72.88,
  "speed": 42, "course": 180, "ignition": true, "status": "offline", "lastUpdate": "...",
  "source": "cached", "lastSeenAt": "..."
}
```

**Frontend:** `gadidosti-admin-dashboard/src/pages/Tracking.jsx` (list + map, 15s poll),
`TrackingDetail.jsx`. Markers use a rotated truck icon (`src/lib/truckIcon.js`, heading from
`course`).

---

## 6. Invoicing, receipts, email, WhatsApp, portal notify

One shared PDF template (`src/utils/invoicePdf.js`, pdfkit) — every consumer sees the exact
same document.

### `GET /api/bookings/{id}/invoice`
**Auth:** client/broker/driver on it, or admin
**Response 200:** `Content-Type: application/pdf`, streamed binary (not the JSON envelope)
**Errors:** 403 no access · 404 booking not found

### `POST /api/bookings/{id}/invoice/email`
**Auth:** same as above — **manual send only, no auto-send, no default recipient**
**Request body:**
```json
{ "to": "email (required)", "subject": "string (required)", "message": "string (required)" }
```
**Response 200:** message `"Invoice sent"`, no `data`
**Errors:** 422 to/subject/message missing

### `POST /api/bookings/{id}/invoice/notify`
**Auth:** broker/driver on it, or admin — **not the client**
**Request body:** none
**Response 200:** message `"Client notified"`, no `data` — creates an in-app notification for the client
**Errors:** 403 only broker/driver/admin can use this

**Auto-notify (no endpoint — fires automatically):**
- Trip → `completed`: client gets an "Invoice Ready" notification.
- `PATCH /api/trips/{id}/collect-payment`: client's "Payment Received" notification also mentions the receipt.

**WhatsApp share** — client-side only (Web Share API + `wa.me` fallback), no backend call.
Helper `shareInvoicePdf()` in each frontend's `utils.js`.

**Email provider:** `EMAIL_PROVIDER=fake` (default, logs only) or `EMAIL_PROVIDER=smtp` (real,
needs `SMTP_HOST/PORT/USER/PASSWORD` + `EMAIL_FROM`). **Currently `fake`.**

**Frontend:** `MyBookings.jsx` (client), `JobDetail.jsx`/`TripDetail.jsx` (broker-driver),
`Invoices.jsx` (admin) — all gated to `["Delivered","Completed"]` bookings.

---

## 7. Trip history, settlements, analytics

### `GET /api/payments/settlements`
**Auth:** broker/driver (own) or admin (all) · query: `page`, `limit`
**Response 200:** `{ "settlements": [ { /* settlement shape */ } ], "total", "page", "limit", "total_pages" }`

### `GET /api/payments/settlements/{id}`
**Auth:** broker/driver on it, or admin
**Response 200:** `{ "settlement": { ... } }`
**Errors:** 403 no access · 404 not found

**Settlement shape** (`projectSettlement`):
```json
{
  "id": "uuid", "bookingId": "uuid", "bookingNumber": "...", "brokerId": "uuid", "driverId": "uuid",
  "route": "...", "truck": "...", "driver": "...",
  "amount": 4500, "platformFee": 105.8, "net": 4394.2, "netEarnings": 4394.2,
  "status": "pending", "settledAt": null, "date": "..."
}
```

### `GET /api/analytics/broker`
**Auth:** broker, driver
**Response 200:**
```json
{ "thisMonth": 45000, "lastMonth": 38000, "tripHistory": [ { /* settlement shape */ } ] }
```

**Frontend:** `gadidosti-broker-driver/src/pages/broker/TripHistoryPage.jsx` (`mode="truck"|"driver"`,
routes `/trucks/:id/history`, `/drivers/:id/history`), `src/pages/driver/TripHistory.jsx`,
`Earnings.jsx`.

---

## 8. Known gaps / things the app owner still needs to do

1. **Run the new migrations** — `npm run migrate` or execute individually in pgAdmin (idempotent):
   - `db/28_driver_request_job_link.sql`
   - `db/29trip_delivered_at.sql`
   - `db/30trip_stops.sql`
   - `db/31tracking_last_known.sql`
2. **Fix Bolt GPS vendor credentials** with Roadcast — `BOLT_API_USERNAME`/`BOLT_API_PASSWORD` currently rejected.
3. **Supply real SMTP credentials** (`.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`, flip `EMAIL_PROVIDER` to `smtp`).
4. **`db/99_vps_reset.sql`** — destructive, only run when actually going live.

---

## 9. Quick file map (frontend)

| App | File | Purpose |
|---|---|---|
| client | `src/pages/BookTruck.jsx` | booking wizard, add-stop UI, live price quote |
| client | `src/pages/RequestDriver.jsx` | direct-pick negotiation screen |
| client | `src/pages/ChooseBroker.jsx` | broker-broadcast negotiation screen |
| client | `src/pages/MyBookings.jsx` | booking list → `BookingDetail.jsx`, invoice actions |
| client | `src/pages/TrackShipment.jsx` | live map, route rail, delivered-state freeze |
| broker-driver | `src/pages/driver/MyTrip.jsx` | active trip, status buttons, stop checklist |
| broker-driver | `src/pages/driver/Requests.jsx` | driver's negotiation inbox |
| broker-driver | `src/pages/broker/JobRequests.jsx` | broker-broadcast inbox |
| broker-driver | `src/pages/broker/DriverRequests.jsx` | broker's escalated-to-them negotiations |
| broker-driver | `src/pages/broker/JobDetail.jsx` | booking detail, live map, invoice actions |
| broker-driver | `src/pages/broker/ActiveJobs.jsx` | in-progress jobs list, "Track Live" link |
| broker-driver | `src/pages/broker/TripHistoryPage.jsx` | truck/driver trip history (full page) |
| admin | `src/pages/Tracking.jsx`, `TrackingDetail.jsx` | live GPS tracking |
| admin | `src/pages/Invoices.jsx` | invoices & receipts list |
| admin | `src/pages/Bookings.jsx` | full booking admin |

---

## 10. Verification note

This document was cross-checked against the current backend source on the date it was
written — every response shape above (`project*` functions), every request body (validation
schemas + swagger annotations), and every route path was read directly from
`src/controllers/*.js` and `src/routes/*.js`, not reconstructed from memory. Everything
described as "built" or "fixed" in this document is present and consistent in the current
codebase — no gaps found during this pass. What's still outstanding is entirely captured in
§8 (migrations to run, vendor credentials, SMTP setup) — those are environment/ops actions on
your end, not missing code.
