# Negotiation + Cancellation API — Integration Guide

A self-contained guide for whoever is building/integrating a client (web, mobile, whatever)
against the driver/broker/client negotiation system, **and** the client's ability to cancel a
booking before pickup (§9). Read §1–8 top to bottom as a sequence; §9 stands alone.

Base URL: your API host, e.g. `https://api.yourdomain.com`. Every endpoint below is prefixed
with `/api`. Every request needs `Authorization: Bearer <access_token>` (obtained from the
normal login endpoint, not covered here). Every response is:
```json
{ "success": true,  "message": "...", "data": { /* shown per-endpoint below */ } }
{ "success": false, "message": "...", "errors": [ /* only on 422 validation errors */ ] }
```

---

## 1. The concept, in plain language

A booking needs a broker + driver + truck assigned to it. There are **two ways** that happens,
and your app needs to handle both:

- **Path A — client picks a specific truck** ("direct-pick"): the client browsed nearby trucks
  and tapped one. That truck's driver gets asked directly.
- **Path B — client doesn't pick a truck** ("broker-broadcast"): every eligible broker in the
  area gets the booking as a lead, negotiates a price, and whichever broker the client picks
  then assigns one of their own drivers — who *also* gets a say before it's final.

Both paths converge on the exact same idea: **whoever ends up being asked to drive gets a
timed window to accept, decline, or counter-offer a different price — and so does the client**,
back and forth, until someone accepts or everyone runs out of time.

There is exactly **one** person actually driving the truck at the end of this, and exactly
**one** `trips` row gets created the moment that's settled. Nothing about pickup/delivery
happens until that point.

---

## 2. Path A — Direct pick, step by step

1. **Browse trucks.** `GET /api/vehicles/trucks/nearby?pickup_lat=..&pickup_lng=..` (not detailed
   further here — it's a plain list endpoint). Client taps one.
2. **Send the request.**
   ```
   POST /api/bookings/{bookingId}/request-truck
   { "truck_id": "uuid" }
   ```
   This creates a `driver_requests` row, targeted at that truck's assigned driver, at the
   booking's current asking price. **Do this once the booking already exists** (i.e. after
   `POST /api/bookings` — booking creation is out of scope for this guide).
3. **The driver has 2 minutes to respond.** They see it via `GET /api/driver-requests` and act
   on `PATCH /api/driver-requests/{id}/accept`, `/decline`, or `/counter`.
4. **If the driver doesn't respond in 2 minutes**, a server-side sweep flags the request and
   hands the decision to their broker instead — same three actions, same endpoints, just a
   different actor. Your app doesn't need to do anything differently here; just keep
   polling/listening (§5) and the payload will show whose turn it is (§4's `driverTimedOut`
   field).
5. **If nobody responds within 5 minutes total**, the request expires automatically. The
   booking was already broadcast as Path B in parallel when it was created (that happens
   server-side, automatically, at `POST /api/bookings` time — you don't trigger it), so your
   app should fall back to showing the broker-broadcast list at this point (`GET
   /api/jobs/requests` won't help the *client* app directly — see the note in §3 about how the
   client discovers this).
6. **Whoever responded (driver or their broker), the client now has three choices**, all
   scoped to the same `driver_requests` id:
   - `PATCH /api/driver-requests/{id}/client-accept` — **this is the final step.** It creates
     the trip immediately. There is nothing after this.
   - `PATCH /api/driver-requests/{id}/client-reject` — booking stays open; go back to step 1
     with a different truck.
   - `PATCH /api/driver-requests/{id}/client-counter` — propose a different number; this resets
     back to step 3 (driver gets a fresh 2-minute window).

---

## 3. Path B — Broker broadcast, step by step

1. **Nothing to send.** `POST /api/bookings` already fanned this out server-side to every
   eligible broker as a `job_requests` row. Your app doesn't call anything to start this.
2. **Brokers respond** via `GET /api/jobs/requests` (broker's own inbox) and
   `PATCH /api/jobs/requests/{id}/decline` or `/counter`. No timer on this side — job requests
   sit open until the client acts (brokers can take their time, unlike the driver side).
3. **Client picks a winning broker**:
   - `PATCH /api/jobs/requests/{id}/client-accept` — locks in this broker. Booking →
     `confirmed`. **No trip yet** — a driver still needs to be assigned.
   - `PATCH /api/jobs/requests/{id}/client-reject` — only valid while that broker's offer is
     `countered`.
   - `PATCH /api/jobs/requests/{id}/client-counter` — propose a number back to one broker.
4. **The winning broker assigns one of their own drivers**:
   ```
   POST /api/jobs/{jobRequestId}/assign-driver
   { "driverId": "uuid", "truckId": "uuid" }
   ```
   This does **not** finalize anything yet — it creates a `driver_requests` row (same table
   Path A uses) and hands it to that driver.
5. **From here it's identical to Path A steps 3–6** — the driver has 2 minutes, escalates to
   the broker after that, expires after 5, and the client finalizes with
   `client-accept`/`client-reject`/`client-counter` on the `driver_requests` id.

**Important for the client app:** at step 4 above, the client didn't create this
`driver_requests` row and has no id for it yet. Use:
```
GET /api/driver-requests/booking/{bookingId}
```
to fetch it — this is exactly what it's for (returns the most recent `driver_requests` row for
a booking, regardless of who created it). Call this once you know the booking is `confirmed`
(step 3 landed) and don't already have a `driver_requests` id in hand.

---

## 4. Endpoint reference

### `driver_requests` object shape
Returned by every endpoint in this section under a `request` key:
```json
{
  "id": "uuid",
  "bookingId": "uuid", "bookingNumber": "BKG-202608-001",
  "clientName": "...", "clientPhone": "...",
  "driverId": "uuid", "driverName": "...", "driverPhone": "...",
  "brokerId": "uuid", "brokerName": "...", "brokerPhone": "...",
  "truckId": "uuid", "truckReg": "MH12AB1234", "truckType": "Medium Truck", "truckCategory": "medium",
  "pickup": "...", "drop": "...", "weight": "5 tons",
  "amount": 4500,
  "status": "pending",
  "jobRequestId": null,
  "driverTimedOut": false,
  "offerHistory": [ { "by": "driver", "amount": 4200, "note": null, "at": "2026-08-10T10:00:00Z" } ],
  "createdAt": "...", "updatedAt": "..."
}
```
- `status`: `pending` (someone owes a response) → `countered` (client owes a response) →
  `accepted` (finalized, trip exists) | `declined` | `expired`.
- **Whose turn it is** — this is the one field your UI logic actually branches on:
  | `status` | `driverTimedOut` | Whose turn |
  |---|---|---|
  | `pending` | `false` | driver |
  | `pending` | `true` | broker |
  | `countered` | — | client |
- `jobRequestId`: non-null only for Path B origin (lets you know this came from a broker
  assignment, not a direct pick — cosmetic, doesn't change what actions are valid).
- `offerHistory`: full back-and-forth, oldest first — render this as the negotiation thread if
  your UI shows one.

---

#### `POST /api/bookings/{id}/request-truck`
Client only. Path A entry point.
**Body:** `{ "truck_id": "uuid" }` (required)
**201:** `{ "request": { ...driver_requests shape... } }`
**Errors:** `403` not your booking · `404` booking/truck not found · `409` booking no longer
pending / truck not available / truck has no driver assigned.

#### `POST /api/jobs/{id}/assign-driver`
Broker only. `{id}` here is the **job_request id**, not the booking id. Path B step 4.
**Body:** `{ "driverId": "uuid", "truckId": "uuid" }` (both required)
**200 (normal case — first assignment):** `{ "request": { ...driver_requests shape... } }`,
message `"Driver offer sent — awaiting response"`
**200 (rare — reassigning a driver on an already-in-progress trip, e.g. after an incident):**
```json
{ "booking": { "id": "uuid", "status": "en_route_pickup", "brokerId": "uuid", "driverId": "uuid", "truckId": "uuid", "pickup": "...", "drop": "...", "timeline": [...], "currentStep": 3 } }
```
message `"Driver reassigned"` — **no negotiation window in this case**, it's instant. You can
tell which response you got by checking for a `request` key vs a `booking` key.
**Errors:** `403` not your job request · `404` not found · `409` job request not `accepted` yet,
or truck not available · `422` missing/invalid driverId/truckId.

#### `GET /api/driver-requests`
Driver or broker. Query: `page`, `limit`.
- As a **driver**, returns requests addressed to you.
- As a **broker**, returns only requests where your driver has already timed out (nothing to
  act on before then, so your inbox doesn't show the rest of your fleet's pending offers).
**200:** `{ "requests": [ ... ], "total", "page", "limit", "total_pages" }`

#### `GET /api/driver-requests/{id}`
Any party to it (client/driver/broker), or admin.
**200:** `{ "request": { ... } }`

#### `GET /api/driver-requests/booking/{bookingId}`
Any party to the booking. **This is the client's way to discover a Path B `driver_requests`
row it didn't create itself** (see §3).
**200:** `{ "request": { ... } }`
**Errors:** `404` no driver request exists for this booking yet.

#### `PATCH /api/driver-requests/{id}/accept`
Driver (while it's their turn) or broker (once `driverTimedOut` is `true`). **No body.**
Accepting here means "yes, at the price currently on the request" — the client still has to
call `client-accept` to actually finalize it (the client already set that price, so this step
is really just "yes I'll do it," not a new number).
**200:** `{ "request": { ..., "status": "accepted" } }`, message `"Accepted — booking confirmed"`
**Errors:** `400` not your turn / already actioned · `403` not yours to respond to.

#### `PATCH /api/driver-requests/{id}/decline`
Driver → broker, same turn rules as accept. **No body.**
**200:** `{ "request": { ..., "status": "declined" } }`

#### `PATCH /api/driver-requests/{id}/counter`
Driver → broker, same turn rules.
**Body:** `{ "amount": 4200, "note": "optional string" }` (`amount` required)
**200:** `{ "request": { ..., "status": "countered" } }` — now it's the **client's** turn.

#### `PATCH /api/driver-requests/{id}/client-accept`
Client only. **This is the finalize step — creates the trip.** No body.
**200:** `{ "request": { ..., "status": "accepted" } }`, message `"Booking confirmed"`
**Errors:** `400` not awaiting your response · `403` not your booking · `409` booking was won
some other way in the meantime (race — show "this offer is no longer available" and refresh).

#### `PATCH /api/driver-requests/{id}/client-reject`
Client only. No body. Booking stays open — go back to picking a truck / waiting on brokers.
**200:** `{ "request": { ..., "status": "declined" } }`

#### `PATCH /api/driver-requests/{id}/client-counter`
Client only.
**Body:** `{ "amount": 4300, "note": "optional string" }` (`amount` required)
**200:** `{ "request": { ..., "status": "pending", "driverTimedOut": false } }` — resets the
driver's window, even if the broker had already taken over.

---

### `job_requests` object shape (Path B only)
Returned under a `request` key:
```json
{
  "id": "uuid", "bookingId": "uuid", "bookingNumber": "...",
  "clientName": "...", "clientPhone": "...", "brokerName": "...", "brokerPhone": "...",
  "pickup": "...", "drop": "...", "distance": 12.4, "truckType": "Medium Truck",
  "weight": "5 tons", "amount": 4500,
  "status": "pending",
  "offerHistory": [ { "by": "client", "amount": 4500, "note": null, "at": "..." } ],
  "timestamp": "2 min ago"
}
```
`status`: `pending` → `countered` → `accepted` | `declined`. No timers on this side.

> ⚠️ **Inconsistency to know about**: `PATCH /api/jobs/requests/{id}/decline` and `.../client-reject`
> return the **raw database row** (snake_case columns like `booking_id`, not the camelCase
> shape above) — they don't run through the same projection the other job-request endpoints
> use. If you're writing a typed client, don't assume a uniform shape across all five
> `job_requests` endpoints; only `counter` and `client-counter` return the clean camelCase
> shape shown above.

#### `GET /api/jobs/requests`
Broker only. Query: `page`, `limit`.
**200:** `{ "requests": [ ... ], "total", "page", "limit", "total_pages" }`

#### `PATCH /api/jobs/requests/{id}/decline`
Broker only. No body.
**200:** `{ "request": { /* raw row */ } }`
**Errors:** `400` already actioned.

#### `PATCH /api/jobs/requests/{id}/counter`
Broker only.
**Body:** `{ "amount": 4600, "note": "optional" }` (`amount` required, min 1)
**200:** `{ "request": { ...camelCase shape... } }`

#### `PATCH /api/jobs/requests/{id}/client-accept`
Client only. Locks in this broker. No body.
**200:** `{ "booking": { "id": "uuid", "status": "confirmed", "brokerId": "uuid", "amount": 4500 } }`
**Errors:** `400` not awaiting your response / race lost · `403` not your booking · `409`
booking no longer available.

#### `PATCH /api/jobs/requests/{id}/client-reject`
Client only. Only valid while that specific offer is `countered`. No body.
**200:** `{ "request": { /* raw row */ } }`

#### `PATCH /api/jobs/requests/{id}/client-counter`
Client only.
**Body:** `{ "amount": 4550, "note": "optional" }` (`amount` required, min 1)
**200:** `{ "request": { ...camelCase shape... } }`

---

## 5. How your app should actually integrate this (polling + sockets)

**Don't build on polling alone if you can help it — sockets exist for exactly this.** But do
implement polling too, as a fallback (the reference web apps do both; sockets can drop, and a
stale negotiation screen is a bad experience).

### Socket (preferred, for live updates)
- Connect with `socket.io-client`, auth via `{ auth: { token: accessToken } }`.
- You're **automatically** joined to a room scoped to your own user id the moment you connect
  authenticated — no explicit "subscribe" call needed for negotiation updates.
- Listen for event **`driver-request-updated`** — the payload is exactly the `driver_requests`
  shape from §4. Every accept/decline/counter/client-* action, and both server-side timeout
  sweeps, emit this straight to whichever user(s) it's relevant to. When you get one, just
  replace your local copy of that request with the payload — no re-fetch needed.
- There's no equivalent push event for `job_requests` (Path B, before a driver is involved) —
  poll that side (below).

### Polling fallback (do this regardless of socket support)
- While viewing an open negotiation screen: poll `GET /api/driver-requests/{id}` (or
  `/booking/{bookingId}` if you don't have the id yet) every **5–8 seconds**. That's frequent
  enough to feel live and cheap enough not to matter.
- While viewing a broker's job-requests inbox (Path B, broker side): poll
  `GET /api/jobs/requests` every 8–15 seconds — no timers on this side, so it's lower urgency.
- Once you get a socket update, you can safely back off polling frequency for that specific
  screen (e.g. 5s → 20s) — reference apps do this rather than removing polling entirely.

### Error handling you actually need to write
- **`400` "already actioned" / "not awaiting your response"**: someone else (broker took over
  from driver, or vice versa) or a race with another device/tab already resolved it. Re-fetch
  the request and update your UI from the fresh state — don't just show a generic error toast,
  the fresh `status`/`driverTimedOut` tells you exactly what to render next.
- **`409` "booking is no longer available"** (only on `client-accept`): another path won the
  booking first (e.g. Path A and Path B were both in flight and the other one finished first).
  Show "this offer is no longer available" and send the user back to booking search/list.
- **Timers are server-authoritative** — don't build your own client-side 2-minute countdown as
  the source of truth for whether an action is still valid; always let the server's `400`
  response be what actually blocks a stale action. A client-side countdown is fine for UI
  polish (showing "1:47 remaining"), just don't trust it over the server.

---

## 6. Timers reference

| Timer | Duration | What happens |
|---|---|---|
| Driver response window | 2 minutes | No response → `driverTimedOut` flips to `true`, broker notified, broker can now act instead |
| Total expiry | 5 minutes from creation | No response from either → request `expired`. Path A falls back to Path B (already running in parallel). Path B: broker needs to assign a different driver. |

Both are enforced by a server cron sweep that runs every minute — so there can be up to ~60s of
lag between "2 minutes elapsed" and `driverTimedOut` actually flipping. Don't build tight
client-side assumptions around the exact second.

---

## 7. Notifications your app should be listening for

Every action above also creates a push/in-app notification (separate from the
`driver-request-updated` socket event — these are for banners/badges, not live state updates).
Relevant `type` values you'll see: `"booking"` (negotiation events) — title/message are
human-readable and safe to show directly, e.g. `"New Ride Offer"`, `"New Counter-Offer"`,
`"Trip Confirmed"`, `"Driver Unavailable"`, `"Offer Accepted"`, `"Offer Declined"`. If you're
building a notification center, these are what populate it — no separate negotiation-specific
notification endpoint exists; it's the same general notifications list every other feature uses.

---

## 8. Worked example — Path A, full happy path

```
1. POST /api/bookings/{bk}/request-truck  { "truck_id": "t1" }
   -> 201 { request: { id: "dr1", status: "pending", driverTimedOut: false, amount: 4500 } }

2. [driver app] PATCH /api/driver-requests/dr1/counter  { "amount": 4200, "note": "long route" }
   -> 200 { request: { id: "dr1", status: "countered", amount: 4200 } }

3. [client app, socket event driver-request-updated arrives with the same payload as step 2]

4. [client app] PATCH /api/driver-requests/dr1/client-counter  { "amount": 4350 }
   -> 200 { request: { id: "dr1", status: "pending", driverTimedOut: false, amount: 4350 } }

5. [driver app] PATCH /api/driver-requests/dr1/accept
   -> 200 { request: { id: "dr1", status: "accepted", amount: 4350 } }

6. [client app] PATCH /api/driver-requests/dr1/client-accept
   -> 200 { request: { id: "dr1", status: "accepted", amount: 4350 } }
   -> trip now exists. GET /api/bookings/{bk} will show status "assigned".
```

Steps 5 and 6 are both real accepts — step 5 is the driver saying "yes I'll drive it," step 6
is the client's final confirmation that actually creates the trip. Both are required in that
order; there's no shortcut where step 5 alone finalizes anything.

---

## 9. Client cancellation — before pickup only

This is a separate feature from negotiation, but it plugs into the same booking lifecycle, so
it's documented here rather than in a third file. **Already implemented and live in the
reference web client (`gadidosti-client`)** — this section is the exact spec to replicate in
any other client (mobile app, etc.).

### The rule

**A client may cancel a booking any time between creation and the driver actually reaching
pickup — never after.** Concretely, cancellation is allowed while `booking.status` is one of:

| Status | Cancellable? |
|---|---|
| `pending` (Requested — no broker/driver yet) | ✅ |
| `confirmed` (broker locked in, no driver yet) | ✅ |
| `assigned` (driver+truck locked in, negotiation finalized) | ✅ |
| `en_route_pickup` (driver is driving there, hasn't arrived) | ✅ |
| `picked_up` and beyond (`in_transit`, `delivered`, `completed`) | ❌ |
| `cancelled` | ❌ (already cancelled) |

**The reasoning your UI should follow**: once cargo is physically in the truck, a plain
"cancel" no longer makes sense — the client needs the dispute/report-a-problem flow instead
(`POST /api/disputes`, not covered here). So:

> **Build rule for the frontend: only render/enable the Cancel action while status is
> `pending`, `confirmed`, `assigned`, or `en_route_pickup`. The moment status becomes
> `picked_up` (or anything after), hide the Cancel action entirely — don't just disable it,
> remove it from the screen — and show the dispute/report-a-problem action in its place if
> your app has one.**

This is exactly what `gadidosti-client/src/pages/BookingDetail.jsx` does:
```js
const isCancellable = ["Requested", "Confirmed", "Assigned", "En Route"].includes(booking.status);
```
(`booking.status` there is already the human-readable label the client API maps `pending` →
`"Requested"`, `en_route_pickup` → `"En Route"`, etc. — if you're consuming the raw enum
values directly instead, use the snake_case table above.)

### A reason is required — always prompt for it

The endpoint rejects a cancel with no reason. **Don't fire the cancel silently on a single
tap** — show a small form/sheet asking why first, then submit. The reason is shown to the
driver/broker in their notification, so it should be free text the client actually typed, not
a hardcoded default.

### `PATCH /api/bookings/{id}/cancel`
**Auth:** client only
**Request body:**
```json
{ "reason": "string (required, non-empty)" }
```
**Response 200:**
```json
{ "booking": { /* full booking shape — status is now "cancelled" */ } }
```
**Errors:**
- `403` — not your booking
- `404` — booking not found
- `409` — `"This booking can no longer be cancelled (status: picked_up)"` — status has already
  passed the cancellable window; your frontend shouldn't be showing the button at this point,
  but handle this response anyway (e.g. a concurrent status change landed between page load and
  tap) by refreshing the booking and updating the UI.
- `422` — `"A cancellation reason is required"` — empty/missing `reason`.

### What happens server-side (so you know what to expect on refresh)

- `booking.status` → `cancelled`. If it had been paid up front, `payment_status` → `refunded`.
- Any still-open negotiation offers on the booking (`job_requests`/`driver_requests`) are
  auto-declined — nobody can accept a booking that was just cancelled out from under them.
- If a driver/truck was already assigned (`confirmed` and later), they're freed back to
  `available`, and the linked trip (if one exists — only for `assigned`/`en_route_pickup`) is
  itself marked `cancelled`.
- **The driver gets notified** (in-app + push) with the client's typed reason in the message,
  e.g. *"The client cancelled booking BKG-202608-001. Reason: found another truck."* The broker
  gets the same notification if one is assigned. No endpoint call needed on your end to trigger
  this — it's automatic on a successful cancel.

### Worked example

```
1. Booking is "assigned" — driver Rakesh is en route to pickup.

2. [client app] Show the "Cancel Booking" action (status is cancellable).
   User taps it -> reason sheet appears -> types "Change of plans, don't need it today."

3. PATCH /api/bookings/{bk}/cancel  { "reason": "Change of plans, don't need it today." }
   -> 200 { booking: { id: "bk", status: "cancelled", paymentStatus: "refunded", ... } }

4. [driver app] Rakesh gets a push notification: "Booking Cancelled — The client cancelled
   booking BKG-202608-001. Reason: Change of plans, don't need it today."
   His next GET /api/trips/active call simply returns { trip: null } — the cancelled trip
   no longer shows as his active trip.

5. [client app] Update local booking state to "Cancelled", hide the Cancel action (already
   handled by the status-based isCancellable check above), show a confirmation toast.
```
