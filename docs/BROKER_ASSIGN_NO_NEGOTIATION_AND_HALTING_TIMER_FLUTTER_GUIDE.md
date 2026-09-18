# Broker-Assigned No-Negotiation Requests + Live Halting Timer — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Two backend changes, checked against the actual `SSK_Cargo`
source — every citation below (file + line) is real, read directly from the repo, not assumed.

---

## 1. Broker-assigned driver requests — accept/decline only, no counter-offers

**What shipped on the backend**: when a broker picks a driver to run an already-negotiated job
(via the broker web app's "Assign Driver & Truck" flow), the resulting `driver_requests` row
carries a non-null `job_request_id` — this is how the backend tells "broker-assign origin" apart
from "direct client-pick origin" (client picked a specific truck off the map, no broker involved).
The price for a broker-assigned row was already agreed between the client and the broker via
`job_requests`; the driver being offered the job is a plain operational "will you do it", so:

- The driver's plain **accept** now finalizes the trip **immediately** — no more two-phase
  mutual-confirmation handshake (`awaiting_confirmation` → wait for the other side) for this
  origin specifically. That handshake (see `MUTUAL_CONFIRMATION_FLOW.md`) still applies in full
  to direct client-pick requests (`job_request_id` null) — nothing changed there.
- **Counter-offers are rejected outright** with `409` on every negotiation endpoint, for both the
  driver and the broker (who can still act on the driver's behalf after a timeout, same as
  before):

| Endpoint | Caller | Broker-assign origin (`jobRequestId` set) |
|---|---|---|
| `PATCH /api/driver-requests/:id/accept` | driver, or broker (post-timeout) | Finalizes immediately — `accepted`, trip created. No `awaiting_confirmation` step. |
| `PATCH /api/driver-requests/:id/decline` | driver, or broker | Unchanged — `declined`. |
| `PATCH /api/driver-requests/:id/counter` | driver, or broker | **409**: `"This job was already agreed with the broker — accept or decline, no counter-offers."` |
| `PATCH /api/driver-requests/:id/client-accept` / `client-reject` / `client-counter` | client | **409**: `"This request is being handled directly with the driver — no action needed from you."` (the client has nothing to do on this row at all — it isn't even shown to them in the web app) |

The `driver_requests` object your app already fetches (via `GET /api/driver-requests`,
`GET /api/driver-requests/:id`, `GET /api/driver-requests/booking/:bookingId`, and the
`driver-request-updated` socket event) already carries the field you need to gate on:
`jobRequestId` (camelCase; `null` for direct client-pick rows). This field is **not currently
read anywhere in `SSK_Cargo`** — confirmed by reading both request models below in full.

### Driver role

`lib/features/driver/data/driver_request_models.dart` — `DriverRequestItem`:
- The class has no `jobRequestId` field at all (field list: lines 40–64; `fromMap` parsing:
  lines 93–172). Add one, parsed the same way every other camelCase/snake_case pair on this
  model is (see the `bookingId` parsing at line 100 for the pattern):
  `jobRequestId: _readString(json, const ['jobRequestId', 'job_request_id'])`.
- `canNegotiate` (lines 66–70) currently only checks `driverTimedOut` and `status` — it should
  also require `jobRequestId.isEmpty`, since a broker-assigned row should never be treated as
  negotiable even while `status == 'requested'`.
- `lib/features/driver/presentation/screens/driver_home_screen.dart` uses `canNegotiate` at
  lines 223, 498, 502, and 543 to gate the incoming-request card's swipe/slide interaction.
- `lib/features/driver/presentation/screens/driver_order_accepted_screen.dart` is the dedicated
  counter-offer screen a driver lands on when acting on a request — it always shows a "Counter
  amount" slider and a "Send counter" action (see the `Counter amount` text at line 895 and the
  `counterDriverRequestAsDriver` call at line 1364), there's no existing branch that skips this
  UI. For a broker-assigned row (`request.jobRequestId` not empty), this screen should instead
  present a plain Accept/Decline choice with no slider and no counter action — e.g. skip straight
  to a simplified summary, or hide the slider/"Send counter" button and adjust the copy at
  line 864 ("Send a counter first...") to something like "Already agreed with the broker — accept
  or decline." Calling accept from here already hits the same `/accept` endpoint, which now
  finalizes immediately for this origin — no other backend-facing change needed once the UI stops
  offering counter.

### Broker role (acting on a driver's behalf after timeout — same rule applies)

`lib/features/broker/presentation/widgets/broker_flow_widgets.dart` — `BrokerDriverRequest`
(field list: lines 213–262) has the same gap — no `jobRequestId` field. Add it the same way.

`lib/features/broker/presentation/screens/broker_driver_requests_screen.dart`:
- `canAct` (lines 261–266) gates Accept/Counter/Decline together — needs to split so Counter is
  independently gated off by `jobRequestId`, while Accept/Decline stay available.
- The three-button pending-status row (Accept / Counter / Decline, lines 432–464) should drop to
  a two-button Accept / Decline row when `request.jobRequestId` is not empty — same visual change
  already made in the web broker app's `DriverRequestCard.jsx` (a "Broker-assigned" badge plus
  removing the Counter button entirely for these rows).

### Trip visibility after accept

No change needed: trip creation (`finalizeDriverRequest` on the backend) is identical regardless
of origin, and `driver_delivery_details_screen.dart` / `GET /api/trips/active` don't filter by
how the trip was created — a broker-assigned trip shows up on the driver's active-trip screen the
same way a direct-pick one does, immediately after the driver's accept call succeeds.

---

## 2. Live Halting Timer — not in `SSK_Cargo` at all yet

**What it is**: for inter-city trips above the base distance threshold, the backend grants a free
"halting" window (in hours) once a trip starts (`startedAt`/`tripStartedAt`) before overage
charges start accruing at a per-hour rate. The web driver app and web client app both already show
a live-ticking indicator for this (`gadidosti-broker-driver/src/components/HaltingTimer.jsx`,
`gadidosti-client/src/components/HaltingTimer.jsx`) — `SSK_Cargo` has **no equivalent at all**
(confirmed: no match for "halt", case-insensitive, anywhere under `lib/`).

The four states to render, identical logic to the two web components above:

1. **Not halting-eligible** — `haltingGraceHours` is `null` (intra-city, or inter-city at/under
   the base distance tier). Render nothing.
2. **Eligible, not started yet** — `haltingGraceHours` present but `startedAt`/`tripStartedAt` is
   null. Show something like *"Free halting window: {graceHours}h once the trip starts."*
3. **Started, still inside the free window** — `now < startedAt + graceHours` hours. Show the
   remaining free time counting down, e.g. *"Free halting time remaining: {duration}"*.
4. **Started, past the free window, trip still in progress** — show *"Halting time exceeded by
   {overage}"*, plus, **driver app only**, a live estimate `overageHours * haltingRatePerHour`
   labeled clearly as an estimate ("~₹X and counting, finalized at delivery").
5. **Trip delivered/completed** — stop ticking; show the final, fixed `haltingHours`/
   `haltingCharge` from the trip/booking object if non-zero (*"Halting charge applied: ₹X for Yh
   over the free Zh window"*), nothing if it was delivered within the free window.

Tick on a plain periodic timer (`Timer.periodic`, e.g. every 30s, matching the web components'
`TICK_INTERVAL_MS`) that just forces a rebuild — every value needed to compute the state is
already on the trip/booking object already being fetched/polled elsewhere; no new endpoint calls
needed just for the timer itself.

### Driver app — `driver_delivery_details_screen.dart`

This screen already fetches the full trip as a raw `Map<String, dynamic>` via `api.getTrip`/
`api.getActiveTrip` and reads fields off it with `_readString(trip, [...])`-style helpers (see
`_loadTrip()`, lines 82–210 — e.g. `_tripStatus`/`_paymentStatus` parsing at lines 170–178). Add
the halting fields the same way, all from the **same trip object already in hand**, keys exactly
as `GET /api/trips/:id` / `GET /api/trips/active` return them (see
`gadidosti-backend/src/controllers/trip.controller.js`'s `projectTrip`, lines 216 and 256–265):

| Field | Type | Notes |
|---|---|---|
| `startedAt` | ISO string \| null | Pair with `haltingGraceHours` for the deadline |
| `haltingGraceHours` | number \| null | Null = not halting-eligible at all |
| `haltingRatePerHour` | number \| null | ₹/hour, for the live overage estimate (state 4) |
| `haltingHours` | number | Final overage hours — only meaningful once delivered |
| `haltingCharge` | number | Final overage charge (₹) — only meaningful once delivered |
| `status` | string | Compare against `delivered`/`completed` for state 5 |

### Client app — `tracking_details_screen.dart` (recommended, not required by the user's request but keeps parity with the web client)

The client-facing screen sources its data from a different endpoint (booking tracking, not
`/api/trips/*` — trip endpoints aren't authorized for the `client` role). If/when you wire this
up, the equivalent booking-level fields (see `gadidosti-backend/src/controllers/booking.controller.js`,
lines 107–117) use **slightly different names** than the trip endpoint — don't reuse the driver
app's field list as-is:

| Field | Notes |
|---|---|
| `tripStartedAt` | Note: **not** `startedAt` here |
| `haltingGraceHours` | Same meaning as above |
| `haltingHours` / `haltingCharge` | Same meaning as above |
| *(no `haltingRatePerHour`)* | Deliberately not exposed to the client — `projectBooking` is synchronous and the live ₹/hr rate needs an async pricing-config read. The client can show "exceeded by Xh" (state 4) but not a live ₹ estimate — only the final `haltingCharge` once delivered (state 5). Same limitation the web client's `HaltingTimer.jsx` already works around. |

Confirm which endpoint `tracking_details_screen.dart`'s `_shipment` is actually built from before
wiring this in — it wasn't traced in full for this guide, only confirmed that it doesn't currently
carry any halting field.
