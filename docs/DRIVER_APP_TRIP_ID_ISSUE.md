# Why the driver app never sees a `tripId` — root cause and fix

Written in response to this exact report from the Flutter app developer:

> The driver accepts a negotiation request. The UI then waits for trip details. The app polls
> `GET /api/driver-requests/:id`, `GET /api/bookings/:id`, and `GET /api/trips/upcoming` every
> 5 seconds. Even after the client finishes booking, the APIs keep returning no usable trip —
> `driver-requests/:id` returns the accepted request but `tripId` is empty, and
> `GET /api/trips/upcoming` returns "No upcoming trip."

**Short answer: this is a wrong-endpoint problem, not a missing-data problem.** The trip already
exists the moment both sides confirm — the app is just polling the one endpoint that, by design,
almost never has anything in it at that exact moment. Fix the endpoint you poll and this
resolves without any backend change.

---

## 1. The actual bug: `/trips/upcoming` was never going to return this trip

Two trip-lookup endpoints exist for the driver, and their names are misleading relative to what
they actually query:

```js
// TripModel.findActiveByDriver — GET /api/trips/active
WHERE tr.driver_id = $1 AND tr.status NOT IN ('delivered', 'completed', 'cancelled')

// TripModel.findUpcomingByDriver — GET /api/trips/upcoming
WHERE tr.driver_id = $1 AND tr.status = 'confirmed' AND tr.id != <whatever /active just returned>
```

A brand-new trip is created with `status = 'confirmed'` (the table's own default — nothing sets
it explicitly, it's just what a fresh row starts as). Read the first query again: `'confirmed'`
is **not** in the excluded list (`delivered`/`completed`/`cancelled`), so **`/trips/active`
returns a freshly created, not-yet-started trip immediately** — despite its name suggesting
"in progress." Then `/trips/upcoming`'s query explicitly excludes whatever `/trips/active` just
returned, so once there's only one trip, `/trips/upcoming` has nothing left to find and
**correctly** returns `"No upcoming trip"` — this is expected, not a bug. `/trips/upcoming` only
ever returns something in the rare case where a driver already has an active trip in progress
*and* a second one is already assigned and waiting behind it.

**The fix for the app: poll/call `GET /api/trips/active`, not `/trips/upcoming`, the moment the
negotiation finalizes.** It already carries the full trip object, including a real `id` field —
that field *is* the tripId, e.g.:

```json
{ "success": true, "data": { "trip": { "id": "6f2a...", "status": "confirmed", "bookingId": "...", ... } } }
```

An earlier internal doc (`DRIVER_TRIP_FLOW_GUIDE.md` §4) told developers to call
`/trips/upcoming` at this exact moment — that guidance was wrong and has been corrected. If your
Flutter dev copied that guidance (or independently assumed "upcoming" means "the thing I was
just assigned, not yet started" — a very reasonable reading of the name that just doesn't match
what the query actually does), that's exactly how this bug reached the app.

## 2. Why `GET /api/driver-requests/:id` never had a `tripId` field

This one's a real, if minor, gap: the `driver_requests` API response was never designed to
expose the linked trip's id — its job is describing the *negotiation*, not the trip. Once
`status` reaches `"accepted"`, a trip is guaranteed to exist (trip creation and the status flip
to `accepted` happen together, atomically, in the same backend transaction) — but the response
shape simply never surfaced that trip's `id`.

**This can be added** — a `tripId` field on the `driver_requests` response (and therefore on the
`driver-request-updated` socket payload too, since it's the same projection) is a safe,
backwards-compatible addition. It hasn't been added yet in this pass — flagging it here as the
concrete follow-up if you want the driver app to be able to read `tripId` straight off the
negotiation object instead of making a second call to `/trips/active`. Let me know if you want
this added; it's a small, low-risk change (one extra `LEFT JOIN trips ON trips.booking_id =
bookings.id` in the driver_requests query, then one field in the response mapper).

## 3. What actually should happen, step by step

```
1. Driver taps Accept → PATCH /api/driver-requests/{id}/accept
   -> 200 { request: { id, status: "awaiting_confirmation" | "accepted", ... } }

   If status is "awaiting_confirmation": the client hasn't confirmed yet (or already had, and
   this WAS the confirming action — check which by whether status is now "accepted"). No trip
   yet if still "awaiting_confirmation" — show the waiting state, keep listening.

2. [socket] event "driver-request-updated" arrives if/when the OTHER side (client) also
   confirms — payload is the same driver_requests shape, now with status: "accepted".
   (See NEGOTIATION_API_GUIDE.md §5 for the socket connection setup, and
   MUTUAL_CONFIRMATION_FLOW.md for the full two-phase-commit state machine — this app was
   recently changed so that EITHER side accepting first just commits that side; the trip is
   only created once BOTH sides have confirmed, not on the first accept alone.)

3. The instant status is "accepted" (from step 1's response directly, or from the socket push
   in step 2 — whichever happens first):
   GET /api/trips/active
   -> 200 { trip: { id: "...", status: "confirmed", bookingId: "...", pickup: {...}, drop: {...}, ... } }
   trip.id is your tripId. Show "Start Delivery" / move this into the Active tab now.

4. Keep polling GET /api/trips/active on screen focus/app resume as a fallback (there's no
   socket push for trip status changes themselves — see DRIVER_TRIP_FLOW_GUIDE.md §6). Once the
   driver taps through en_route_pickup -> picked_up -> in_transit -> delivered -> completed
   (PATCH /api/trips/{id}/status each time — see DRIVER_TRIP_FLOW_GUIDE.md §5), the same
   /trips/active call keeps returning the same trip with its updated status until it reaches
   delivered/completed, at which point /trips/active correctly returns null and the driver is
   free again.
```

## 4. Direct answers to the four backend asks in the original report

1. **"Make sure the driver request or booking record gets a real tripId"** — it already does,
   the moment both sides confirm; it's just not exposed on the `driver_requests`/`bookings`
   response bodies themselves today. `GET /api/trips/active` is the correct place to read it
   right now; adding a `tripId` field directly to the `driver_requests` response is a reasonable
   follow-up (see §2) if you'd rather not make a second call.
2. **"One of these should return tripId/the new trip immediately"** — `GET /api/trips/active`
   already does this immediately, no change needed. Point the app at it instead of
   `/trips/upcoming`.
3. **"Emit a websocket event with requestId/bookingId/tripId/status"** — `driver-request-updated`
   already fires the instant either side finalizes (see `MUTUAL_CONFIRMATION_FLOW.md`), carrying
   `id` (the driver_request's own id — use this as your `requestId`), `bookingId`, and `status`.
   It does not currently carry `tripId` (same gap as §2 above) — again, addable on request, but
   not required to unblock the app: on receiving this event with `status: "accepted"`, just call
   `GET /api/trips/active` to get the trip object, same as step 3 above.
4. **"Trip status should move into a live status"** — it already starts at `confirmed` the
   moment it's created (not stuck at some pre-trip placeholder state), and advances through
   `en_route_pickup` → `picked_up` → `in_transit` → `delivered` → `completed` as the driver taps
   through each step. No change needed here either.

## 5. Bottom line for the Flutter dev

Swap the poll target from `/trips/upcoming` to `/trips/active` at the moment
`driver-request-updated`/the accept response shows `status: "accepted"`, and the "no usable
trip" problem goes away — `/trips/active` has been returning the freshly confirmed trip the
whole time, just not at the endpoint anyone was asking.
