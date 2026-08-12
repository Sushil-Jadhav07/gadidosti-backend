# Driver App — Offer to Settlement: API + Socket Flow

Self-contained guide for whoever is building/integrating the **driver app** (mobile or
otherwise) — from the moment a new job offer reaches the driver, through negotiation, trip
creation, the full trip status lifecycle, and up to the booking being fully settled. Companion
to `NEGOTIATION_API_GUIDE.md` (written from the client's side, plus the Pay Now/Pay Later flow
in its §10) — this one is written from the driver's side and doesn't require reading that one
first, though the two describe the same underlying system.

Base URL: your API host, e.g. `https://api.yourdomain.com`. Every endpoint below is prefixed
with `/api`. Every request needs `Authorization: Bearer <access_token>`. Every response is:
```json
{ "success": true,  "message": "...", "data": { /* shown per-endpoint below */ } }
{ "success": false, "message": "...", "errors": [ /* only on 422 validation errors */ ] }
```

---

## 1. Socket connection — set this up once, keep it open the whole session

```js
import { io } from "socket.io-client";
const socket = io(BASE_URL, { auth: { token: accessToken }, transports: ["websocket", "polling"] });
```
The moment you connect authenticated, you're **automatically joined to a room scoped to your
own user id** — no explicit subscribe call. Every event below arrives on this one connection;
you don't open a second socket for negotiation vs. payment vs. anything else.

Events you'll receive on it over the course of one job:
| Event | When | Covered in |
|---|---|---|
| `driver-request-updated` | New offer, any negotiation action, trip created | §2–§4 below |
| `booking-payment-updated` | Client pays via the app (Pay Now) | §5 below |

**There is no socket event for trip status changes themselves** (en_route_pickup, picked_up,
etc.) — that part is poll-based. See §6.

---

## 2. How a new job offer reaches you

Two different origins both end up creating the same kind of row (a `driver_requests` row)
addressed to you:

- **Direct pick** — the client picked your specific truck: `POST /api/bookings/{id}/request-truck`
  (client-initiated, you don't call this).
- **Broker broadcast** — your broker assigned you to a booking they won: `POST /api/jobs/{id}/assign-driver`
  (broker-initiated, you don't call this either).

Either way, **the instant that row is created, you get pushed `driver-request-updated` on your
own socket room** — that's your "new offer" signal, and it's the intended replacement for
polling an inbox. Payload:
```json
{
  "id": "uuid",
  "bookingId": "uuid", "bookingNumber": "BKG-202608-001",
  "clientName": "...", "clientPhone": "...",
  "driverId": "your-uuid", "driverName": "...", "driverPhone": "...",
  "brokerId": "uuid", "brokerName": "...", "brokerPhone": "...",
  "truckId": "uuid", "truckReg": "MH12AB1234", "truckType": "Medium Truck", "truckCategory": "medium",
  "pickup": "...", "drop": "...", "weight": "5 tons",
  "amount": 4500,
  "status": "pending",
  "jobRequestId": null,
  "driverTimedOut": false,
  "offerHistory": [],
  "createdAt": "...", "updatedAt": "..."
}
```
`jobRequestId` is non-null only if this came from a broker assignment (Path B) — cosmetic, both
origins behave identically from here on.

**Fallback poll** (socket can drop): `GET /api/driver-requests?page=&limit=` — returns requests
addressed to you as the driver. Poll every 8–15s while your "Requests"/inbox screen is open;
back off once you've received a live update for that screen.

---

## 3. Negotiation — the actions you can take on an offer

**Whose turn it is** is the one thing your UI actually branches on:

| `status` | `driverTimedOut` | Whose turn |
|---|---|---|
| `pending` | `false` | **you** |
| `pending` | `true` | your broker (you didn't respond within 2 minutes) |
| `countered` | — | the client |

While it's your turn:

#### `PATCH /api/driver-requests/{id}/accept`
Accept **at the amount currently on the request** — no body. This doesn't just record your
"yes," it can immediately finalize the whole booking (see §4).
**200:** `{ "request": { ...status: "accepted" } }`, message `"Accepted — booking confirmed"`
**Errors:** `400` not your turn / already actioned · `403` not yours to respond to.

#### `PATCH /api/driver-requests/{id}/decline`
No body.
**200:** `{ "request": { ...status: "declined" } }`

#### `PATCH /api/driver-requests/{id}/counter`
**Body:** `{ "amount": 4200, "note": "optional string" }` (`amount` required)
**200:** `{ "request": { ...status: "countered" } }` — now it's the client's turn; you'll get a
`driver-request-updated` push when they respond (counter again, or accept).

If you ignore an offer for 2 minutes, `driverTimedOut` flips to `true` server-side and your
broker can act in your place. At 5 minutes total with no resolution from either side, the
request `expires` and (for a direct pick) the client's app automatically falls back to broker
offers — nothing further for you to do once that happens.

---

## 4. Trip creation — who triggers it, and how you find out

**Key thing to build correctly: either side can finalize the booking.** Your own
`PATCH .../accept` above, and the client's `PATCH .../client-accept` (their side, documented in
`NEGOTIATION_API_GUIDE.md`), both run the exact same finalize step server-side. Whichever one
happens first wins the booking and creates the trip immediately; if the other side's action
arrives after, it gets a `409` (already resolved) instead of double-processing. **You don't
wait for a separate confirmation after you accept — accepting *is* the confirmation.**

The moment either side finalizes it:
- `driver_requests.status` flips straight to `"accepted"`.
- A `trips` row is created (starts at status `"confirmed"`), linked to you.
- You receive `driver-request-updated` again, now with `status: "accepted"`.

**What to do when you receive that:** the `driver-request-updated` payload is still the
negotiation shape (§2) — it is **not** the trip object. Immediately call:
```
GET /api/trips/upcoming   // if you haven't started it yet — status still "confirmed"
```
and navigate to your "My Trip" / trip-detail screen with whatever it returns. From this point
on, everything is trip-scoped (§5), not negotiation-scoped.

---

## 5. Trip status lifecycle — the APIs you call until the booking is over

```
confirmed → en_route_pickup → picked_up → in_transit → delivered → completed
     ↓ (only from confirmed, before you've started)
  (declined by you — trip deleted, broker re-assigns)
```
`cancelled` can also happen at any point before `picked_up` (client-initiated cancellation —
not something you trigger).

#### Main endpoint: `PATCH /api/trips/{id}/status`
**Body:** `{ "status": "en_route_pickup" }` (one of the values above)
**200:** `{ "trip": { ...full trip shape... } }`
**Idempotency:** pass an `Idempotency-Key` header if you want a retried tap to be a safe no-op
instead of erroring.

Two things gate this call:
- **Proximity (0.8km)** — enforced only for `picked_up` and `delivered`. Compares your last
  reported location (`trip.currentLocation`, kept fresh by the location ping below) against the
  pickup or drop coordinates. Fails `409` with the distance if you're too far, or if no location
  has been reported yet ("enable location sharing and try again").
- **Stop checklist** — only relevant if this trip has extra loading/unloading stops beyond the
  base pickup/drop (`trip.stops.length > 2` — most trips don't). You can't move to `in_transit`
  while any `loading` stop is still pending, or to `delivered` while any `unloading` stop is
  still pending. See below.

#### Extra stops (only if `trip.stops` has more than the base pickup+drop pair)
`trip.stops` is an ordered array: `[pickup, ...loading stops, ...unloading stops, drop]`, each
`{ type, location, lat, lng, status: "pending"|"done", completedAt }`. Only render a checklist
UI when you see `loading`/`unloading` entries — most trips are just `[pickup, drop]` and need
none of this.
```
PATCH /api/trips/{id}/stops/{index}/complete
```
No body. Same 0.8km proximity gate as pickup/delivered, plus **sequential-within-type** — you
can't complete loading stop 2 before loading stop 1. **409** covers all three failure cases (too
far / out of order / already done) — read the message, it tells you which.

#### Location ping: `PATCH /api/trips/{id}/location`
**Body:** `{ "lat": 19.076, "lng": 72.877 }`
Call this frequently while a trip is active — it's what the proximity checks above actually
read. (This is separate from `PATCH /api/vehicles/drivers/me/location`, an always-on
device-tracking ping that feeds the live map's `truck-location` socket channel for broker/client
tracking views — send both if your app does both; they serve different consumers.)

#### Backing out before you've started: `POST /api/trips/{id}/decline`
Only valid while `status` is still `confirmed` (you haven't tapped "Start Trip to Pickup" yet).
No body. Frees you and the truck, deletes the trip, and lets your broker assign someone else.
**409** once you're past that point — use report-issue instead (`POST /api/trips/{id}/report-issue`,
not detailed further here, out of scope for the happy path).

#### Proof of delivery: `POST /api/trips/{id}/pod`
Multipart, field name `files`, up to 6 photos total across all calls for one trip. Only allowed
while `status` is `in_transit` or `delivered`. **200:** `{ "podPhotos": [...every url so far] }`.

#### Payment — check before you build a "collect payment" screen
`trip.paymentStatus` tells you whether there's anything left to collect:
- **`"paid"`** — the client already paid in the app (Pay Now). **Skip payment collection
  entirely** — there's nothing to do. You'd have already gotten a live push for this the moment
  it happened:
  ```
  event: booking-payment-updated
  payload: { bookingId, bookingNumber, paymentStatus: "paid", paymentMode }
  ```
  (Same socket connection as §1 — full detail in `NEGOTIATION_API_GUIDE.md` §10.) Show a "Paid"
  badge and move straight to wrapping up the trip.
- **`"pending"`** — still COD. Collect cash or UPI, then record it:
  ```
  PATCH /api/trips/{id}/collect-payment   { "mode": "upi" }   // or "cash"
  ```
  **200:** `{ "paymentStatus": "paid", "paymentMode": "upi" }`. **409** if it turns out someone
  already recorded payment for this booking (e.g. the client paid in-app right before you tapped
  collect) — treat that as success and move on, don't show an error.

#### Final step — completing the trip
Once POD is uploaded and payment (if it was still pending) is recorded:
```
PATCH /api/trips/{id}/status   { "status": "completed" }
```
This is the call that actually matters financially — it creates the settlement record, frees
you and your truck back to `"available"`, and increments your trip count. **It's safe to retry**
(idempotent — a second call on an already-completed trip just returns the same trip, no
double-payout). You get a `"Trip Completed"` notification; the client gets `"Invoice Ready"`.
This is the end of the flow for this booking.

---

## 6. No live push for trip status — this part is poll-based

Unlike negotiation (§2–§4) and payment (§5), a trip's own status changes don't emit a socket
event to anyone. Your app already knows the new status immediately because *you're* the one who
just PATCHed it — update your local state from that response directly. For anything else that
might have changed the trip out from under you (broker reassigned it after an incident, etc.),
poll `GET /api/trips/active` on screen focus / app resume rather than expecting a push.

---

## 7. Worked example — one job, start to finish

```
1. [socket] event "driver-request-updated"
   payload: { id: "dr1", status: "pending", driverTimedOut: false, amount: 4500, bookingNumber: "BKG-202608-001", ... }
   -> New offer. Show it in your inbox / a modal.

2. PATCH /api/driver-requests/dr1/accept
   -> 200 { request: { id: "dr1", status: "accepted", amount: 4500 } }
   Booking is finalized right now — a trip already exists.

3. GET /api/trips/upcoming
   -> 200 { trip: { id: "t1", status: "confirmed", bookingId: "bk1", stops: [pickup, drop], paymentStatus: "pending", ... } }
   Navigate to "My Trip" with this.

4. PATCH /api/trips/t1/location   { lat: 19.05, lng: 72.85 }         // repeat periodically
5. PATCH /api/trips/t1/status     { status: "en_route_pickup" }      -> 200 { trip: {...} }
6. PATCH /api/trips/t1/status     { status: "picked_up" }            -> 200, or 409 if not within 0.8km of pickup
7. PATCH /api/trips/t1/status     { status: "in_transit" }           -> 200 (or 409 if extra loading stops still pending)

   ...meanwhile, if the client pays via the app...
8. [socket] event "booking-payment-updated"
   payload: { bookingId: "bk1", bookingNumber: "BKG-202608-001", paymentStatus: "paid", paymentMode: "upi" }
   -> Show a "Paid" badge. Skip step 11 below.

9. POST /api/trips/t1/pod   (multipart, 2 photos)
   -> 200 { podPhotos: ["https://.../photo1.jpg", "https://.../photo2.jpg"] }
10. PATCH /api/trips/t1/status   { status: "delivered" }             -> 200 (or 409 if unloading stops still pending)

11. [only if step 8 never happened — paymentStatus is still "pending"]
    PATCH /api/trips/t1/collect-payment   { mode: "cash" }
    -> 200 { paymentStatus: "paid", paymentMode: "cash" }

12. PATCH /api/trips/t1/status   { status: "completed" }
    -> 200 { trip: { ..., status: "completed" } }
    Settlement created, you're freed back to "available". Done — booking is over.
```
