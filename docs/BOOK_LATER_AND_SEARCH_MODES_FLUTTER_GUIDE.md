# Book Later, Find Truck / Search for Broker, and Halting Charges — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Three related backend changes just shipped. Checked against the
actual `SSK_Cargo` source (not assumed) — every citation below is a real file/line in the app as
it stands today.

**The most important thing to know: none of this breaks the app as it currently works.** Every
new field is optional and defaults to today's exact behavior. You can ship nothing and the app
keeps working exactly as it does now. Read on for what's *possible* to build on top of that.

---

## 0. What already exists in the app (context for everything below)

- `BookingData` (`client_flow_widgets.dart:616-730`) already has a `scheduledDate` field
  (`DateTime?`, line 633/659), but it's never surfaced to the user — every call site that
  constructs a `BookingData` hardcodes it to `DateTime.now().add(const Duration(hours: 3))`
  (lines 1648, 2408) or falls back to that same expression if null (line 3400 in
  `_bookingPayload()`). There's no date/time picker UI anywhere for it today.
- `_bookingPayload()` (`client_flow_widgets.dart:3398-3427`) is what actually gets sent to
  `POST /api/bookings` — it does **not** send `is_scheduled` today, so the backend always
  broadcasts immediately regardless of what `scheduled_date` says. This is exactly why nothing
  breaks: the backend only defers anything when `is_scheduled: true` is explicitly sent.
- `_createDirectTruckRequestSession()` (`client_flow_widgets.dart:3342-3396`) is today's
  "client picks one specific truck" flow: it creates the booking, then immediately calls
  `POST /api/bookings/:id/request-truck` (`api_client.dart:237-253`,
  `requestTruckForBooking()`) with that one `truckId`. **This endpoint still exists and still
  works exactly as before** — nothing about it changed on the backend.
- `BookingData.brokerId` / `BookingData.truckId` (lines 638-639, 664-665) already exist as
  fields, currently used only for the direct-pick flow above — no broker-picker UI exists yet.

---

## 1. Book Later

Client schedules a booking for a future date/time instead of "now". The booking is still created
immediately (status `pending`, visible right away) — only the broker/driver notification is
deferred, automatically, by the backend (a cron sweep fires it ~2 hours before the scheduled
time; no Flutter-side timer or background task needed).

**What to send** — add two fields to `_bookingPayload()`'s returned map (`client_flow_widgets.dart:3401`):
```dart
'scheduled_date': scheduled.toUtc().toIso8601String(), // already sent today
if (isBookLater) 'is_scheduled': true,
```
- `is_scheduled: true` requires `scheduled_date` to be in the future — the backend 422s
  otherwise (`"scheduled_date is required when is_scheduled is true"` /
  `"scheduled_date must be in the future when is_scheduled is true"`). Validate this client-side
  too before submitting, same as any other required-field check.
- Omit `is_scheduled` entirely (or send `false`) for "book now" — today's behavior, unchanged.

**What to build**: a "Book Now" / "Book Later" toggle somewhere in the booking flow, and when
"Later" is picked, a real date/time picker feeding `BookingData.scheduledDate` instead of the
hardcoded `now + 3h`. Track the toggle's state alongside the draft (a new
`bool isScheduled`-style field on `BookingData`, mirroring how `brokerId`/`truckId` are already
plain fields on it).

**What happens after creation**: the booking's projection (`GET /api/bookings/:id`, and the
object returned by `POST /api/bookings` itself) now includes `isScheduled: bool`,
`broadcastAt: string | null` (ISO timestamp — when the deferred broadcast will fire),
`broadcastTriggeredAt: string | null` (null until it actually fires). For a scheduled booking,
don't drop the user into a live "waiting for a driver/broker" screen the way the immediate flow
does — nothing will happen until `broadcastAt` arrives. Show a simple "Scheduled — we'll notify
[drivers/brokers] closer to your pickup time" confirmation instead.

---

## 2. Find Truck vs Search for Broker (mutually exclusive)

Today, creating a booking always broadcasts to **every** eligible broker in the city
(`job_requests`, unconditional), and *separately* the client can optionally also request one
specific truck directly (`_createDirectTruckRequestSession`, both happen in parallel — whichever
side accepts first wins). The new design replaces "both in parallel" with an explicit,
mutually-exclusive choice the client makes per booking:

- **`search_mode: 'truck'`** ("Find Truck") — instead of picking one specific truck from a map,
  the client picks a **radius** and the offered amount is broadcast to *every available driver*
  within that radius (one `driver_requests` row per driver, same as today's single-truck request
  but fanned out to many at once). First driver to accept wins — every other driver's request for
  that booking is then automatically declined server-side, no client action needed.
  Send `search_radius_km` (number, 0.5–200 km; defaults to 15 if omitted) alongside it.
- **`search_mode: 'broker'`** ("Search for Broker") — instead of broadcasting to every eligible
  broker, the client browses a list and picks exactly **one**; the request goes only to them.
  Send `broker_id` (UUID) alongside it — **required** in this mode (422 without it).
- **Omit `search_mode` entirely** to keep today's exact legacy behavior (broadcast to every
  eligible broker, `job_requests`, unchanged) — this is what happens if you ship nothing further.
  You do not need to combine this with the direct-truck-pick flow above; they're independent of
  whether `search_mode` is sent at all.

**New endpoint — browse brokers before picking one** (`GET /api/bookings/eligible-brokers`, not
booking-scoped, call it before/while building the create-booking request):
```
GET /api/bookings/eligible-brokers?city=<optional>
Authorization: Bearer <accessToken>
```
```json
{ "success": true, "data": { "brokers": [
  { "id": "uuid", "name": "Acme Logistics", "phone": "+91...", "serviceCity": "Indore", "isOnline": true, "truckCount": 4 }
] } }
```
Add an `Future<Map<String, dynamic>> getEligibleBrokers(...)` method to `api_client.dart` next to
the other booking GET calls (mirrors `getBookingOffers`, `api_client.dart:788-795`, in shape).

**New endpoint — watch a "Find Truck" broadcast** (`GET /api/bookings/:id/driver-requests`,
client-only): because "Find Truck" can create *many* `driver_requests` rows for one booking, the
existing `GET /api/driver-requests/booking/:bookingId` (singular — always returns just the one
most-recently-created row) is **not safe to use** for this new flow; it can show you an arbitrary
sibling instead of the one that actually gets accepted. Use this instead:
```
GET /api/bookings/:id/driver-requests
```
```json
{ "success": true, "data": { "requests": [ /* array — same shape as a single driver_request today */ ], "bookingStatus": "pending" } }
```
Poll this while waiting for the broadcast to get a response (same polling cadence you'd already
use for the existing driver-request negotiation screen). The moment any entry's status needs the
client's attention (e.g. the driver countered, or accepted and is waiting on the client's
mutual-confirmation), switch to that entry's `id` and drive the existing
`PATCH /api/driver-requests/:id/client-accept` / `client-reject` / `client-counter` flow exactly
as you already do today for the single-truck-pick case — those endpoints and their behavior are
completely unchanged, only *how you discover which request id to act on* is new.

**What to build**: replace (or add alongside — your call) the current map-based single-truck
picker with two mutually-exclusive option cards: "Find Truck" (radius slider) and "Search for
Broker" (the broker list above, single-select). Add `searchMode` / `searchRadiusKm` /
`selectedBrokerId` fields to `BookingData`, and branch `_bookingPayload()` to include
`search_mode` + `search_radius_km` or `broker_id` accordingly. The web client (`gadidosti-client`)
just shipped the same UI concept if you want a reference for the interaction pattern (not the
code — different framework).

---

## 3. Inter-city halting charges — informational only, nothing to build unless you want to

Backend-only automatic feature: once an inter-city trip (distance > 200km) exceeds a
distance-tiered free grace period (200–400km → 6h, 400–600km → 8h, 600km+ → 12h) before
delivery, an overage charge is computed automatically at the moment the driver marks the trip
delivered, using the truck category's existing waiting/hr rate. It's already folded into the
total the driver collects — you don't compute or send anything for this.

If you want to surface it (optional):
- Booking projection (`GET /api/bookings/:id`) now includes `haltingHours: number` and
  `haltingCharge: number` (both `0` when not applicable).
- `POST /api/bookings/quote` — for an inter-city quote over 200km, the response now optionally
  includes `halting: { graceHours: number, ratePerHour: number }` (null otherwise) — you could
  show this as a one-line note near the price breakdown ("Free halting: 6h, then ₹150/hr") on
  the quote/review screen, same spot `RAZORPAY_AND_RATING_FIX_FLUTTER_GUIDE.md`'s pricing
  breakdown lives.
- On the booking-detail/invoice screen, if `haltingCharge > 0`, you could show it as its own line
  item the same way the web client now does, so the client understands why the final amount is
  higher than the original quote — not required, the total is correct either way.

---

## Full API reference (new/changed only)

**`POST /api/bookings`** (existing) — new optional fields:
| field | type | notes |
|---|---|---|
| `is_scheduled` | boolean | Requires `scheduled_date` in the future. Defers broadcast. |
| `search_mode` | `'truck' \| 'broker'` | Omit for legacy (broadcast to every eligible broker). |
| `search_radius_km` | number | Only used with `search_mode: 'truck'`. 0.5–200, default 15. |
| `broker_id` | uuid | **Required** with `search_mode: 'broker'`. |

**`GET /api/bookings/eligible-brokers?city=<optional>`** — new, client-only, list brokers to pick from.

**`GET /api/bookings/:id/driver-requests`** — new, client-only, list every driver_requests
sibling for a booking (needed for `search_mode: 'truck'`; do not use the old singular
`GET /api/driver-requests/booking/:bookingId` for this).

**`POST /api/bookings/:id/request-truck`** (existing, unchanged) — still works exactly as today
for a manual single-truck pick, if you choose to keep that path alongside/instead of
`search_mode: 'truck'`.

**Booking projection** — new fields: `isScheduled`, `broadcastAt`, `broadcastTriggeredAt`,
`searchMode`, `searchRadiusKm`, `selectedBrokerId`, `haltingHours`, `haltingCharge`.

**Trip projection** (`GET /api/trips/:id` etc.) — new fields: `haltingHours`, `haltingCharge`
(already included in `amountToCollect`).

**`POST /api/bookings/quote`** — new optional `halting: { graceHours, ratePerHour } | null` on
inter-city responses over 200km.
