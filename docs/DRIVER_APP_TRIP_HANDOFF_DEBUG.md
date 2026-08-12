# Driver app not showing "confirmed" after both sides accept — diagnosis

Follow-up to `DRIVER_APP_TRIP_ID_ISSUE.md` and `DRIVER_APP_SOCKET_GUIDE.md` — those two are now
working (the client's accept reaches the driver app, and the driver can confirm). This is the
next link in the same chain: **after both sides have accepted, the driver app still doesn't show
the trip as confirmed.**

## 1. What the log actually shows — the backend is correct here

```
[SSK.API] Request succeeded status=200 path=/api/bookings/369b2e41-c143-4546-8ff6-8034778584d3
[driver.orderAccepted] Handoff booking response received: { booking: {
  status: "assigned", driverId: "dc5fd2e8-...", truckId: "a8ed4100-...",
  driver: { name: "Harsh Nikharge", phone: "7894282335" }, truckReg: "MH-02-AB-4566",
  timeline: [pending, confirmed, assigned], currentStep: 2, ...
} } }
```

`booking.status: "assigned"` **only ever happens once `finalizeDriverRequest` has fully run** —
that's the same function that creates the `trips` row, locks the truck/driver to `on_trip`, and
flips the booking. Since this booking already shows `assigned` with `driverId`/`truckId`/`driver`
all populated, **the mutual-confirmation handshake completed correctly and a trip row already
exists in the database.** This is not a backend data problem — nothing here needs fixing
server-side. The problem is entirely in what happens next in the Flutter app.

## 2. The missing piece: what did `GET /api/trips/active` actually return?

Right after the booking fetch, the log shows:
```
[SSK.API] GET /api/trips/active
```
...and then nothing. No response logged for that call. **This is the exact piece of information
needed to finish diagnosing this** — please add a log line for its response (success/failure,
and the full body) and send that over, the same way the booking response was logged. Everything
below is what to check while you're getting that, since a few of these are common enough to be
worth ruling out immediately.

### What the response *should* look like

Given the booking data already confirmed above, `GET /api/trips/active` (called as the driver,
i.e. `dc5fd2e8-...`) should return something shaped like this:

```json
{
  "success": true,
  "message": "Active trip fetched",
  "data": {
    "trip": {
      "id": "<some-new-uuid, not the booking id>",
      "bookingId": "369b2e41-c143-4546-8ff6-8034778584d3",
      "bookingNumber": "BKG-202608-005",
      "status": "confirmed",
      "driverId": "dc5fd2e8-d543-42e6-a0de-6f074549f1bf",
      "driverName": "Harsh Nikharge",
      "truckId": "a8ed4100-eb20-4294-a3c9-de3cb345ba40",
      "truckReg": "MH-02-AB-4566",
      "pickup": { "location": "Anand Sagar Building, VSNL Colony, Mahim, Mumbai, Maharashtra 400016", "lat": 19.030827, "lng": 72.845303, ... },
      "drop": { "location": "shop no -6, Om Sai CHS, Mogul Ln, ...", "lat": 19.032615, "lng": 72.845963, ... },
      "stops": [ { "type": "pickup", "status": "pending", ... }, { "type": "drop", "status": "pending", ... } ],
      "cargo": { "material": "Electronics", "weight": "1.00", "quantity": 1, ... },
      "earnings": 1062.95,
      "paymentStatus": "pending",
      "currentLocation": { "lat": null, "lng": null },
      "timeline": [ { "step": "Pickup", "done": false, "time": null }, ... ],
      "createdAt": "...", "updatedAt": "..."
    }
  }
}
```

Key thing to check: **`trip.status` is `"confirmed"` here — not `"assigned"`.** These are two
completely different status fields on two different tables (`bookings.status` vs `trips.status`)
that happen to both exist at the same time for the same booking. If your app's handoff logic is
checking `trip.status == "assigned"` (copying the booking-status value you just saw) to decide
whether to show the confirmed/active trip screen, **that check will never be true** — a trip's
own status starts at `"confirmed"` and only becomes `"en_route_pickup"`/etc. once the driver
starts progressing through the delivery (see `DRIVER_TRIP_FLOW_GUIDE.md` §5). This is the single
most likely app-side bug given everything else already lines up correctly.

## 3. Checklist, in order of likelihood

1. **Status-field mix-up (see above)** — confirm the app isn't comparing `trip.status` against
   `"assigned"` anywhere. The trip is genuinely confirmed the moment `trip.status` is anything
   other than `null`/absent — for the driver's "show this in the Active tab" check, the right
   test is simply *"did `/trips/active` return a non-null `trip`"*, not a specific status string.
2. **The `/trips/active` call errors or times out silently** — if there's no try/catch/error
   log around it, a thrown exception could be silently swallowed and the UI just never updates.
   Add explicit logging on both the success and failure/catch paths for this call, the same way
   the booking fetch above is logged.
3. **Two different IDs being compared** — if the app's "handoff" logic matches the incoming
   `driver-request-updated` socket payload's `bookingId` against something before deciding to
   call `/trips/active`, double check it's comparing the right two values (`bookingId` from the
   socket payload vs. whatever the app already has in memory) — an off-by-one on which id field
   is used (`id` vs `bookingId` vs `tripId`) between the driver_requests shape and the trip shape
   is an easy mistake since both objects have an `id` field that means something different.
4. **Race between screens** — if `/trips/active` is called from a screen that gets torn down
   (navigated away from) before the response arrives, the state update can get dropped depending
   on how your state management handles updates after unmount. Confirm the call is issued from
   (or its result is delivered to) whatever screen/controller actually owns the "Active tab"
   state, not a transient negotiation screen that's about to be replaced.
5. **Polling never started** — if the plan is "call `/trips/active` once after the handoff, then
   rely on polling to keep it updated," confirm the polling loop actually starts after this first
   call succeeds. A single one-shot call that silently fails (per #2) with no retry/poll behind
   it would look exactly like "nothing happens."

## 4. What to send back if the checklist doesn't resolve it

The actual response body (success or error) of the `GET /api/trips/active` call from this exact
scenario — that's the one piece of evidence that turns "probably #1 or #2" into a definite
answer.
