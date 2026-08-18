# New: Live Trip Status Socket Event — `trip-status-updated`

For the Flutter app developer. A new real-time channel just went live on the backend so that
**client, broker, and driver all see a trip's status change instantly — no reload, no waiting
out a poll interval.** This doc is everything needed to wire it into the Flutter apps
(`SSK_Cargo`), both the client side and the driver/broker side. The reference web apps
(`gadidosti-client`, `gadidosti-broker-driver`) already have this integrated — this doc describes
exactly what they now do, so the Flutter apps can match it.

---

## 1. What changed, and why

Previously, once a trip existed, status changes (`confirmed` → `en_route_pickup` → `picked_up` →
`in_transit` → `delivered` → `completed`) were **poll-only** — nobody but the driver who made the
change found out until their next poll tick (up to several seconds of lag), and some screens
(the broker's job detail page, in particular) had no live update mechanism at all, only a manual
reload.

Every `PATCH /api/trips/{id}/status` call now **also** pushes the fresh trip to everyone with a
stake in it — the same socket connection already used for negotiation (`driver-request-updated`)
and payment (`booking-payment-updated`) events, just one more event name to listen for.

## 2. Who receives it, and when

Fires on **every** successful `PATCH /api/trips/{id}/status`, regardless of who called it (driver
progressing the trip, broker completing delivery on a driver's behalf, admin override) or what
the new status is. Pushed to three rooms at once — the booking's **client**, the trip's
**broker**, and the trip's **driver** — via the same auto-joined `user:{yourOwnUserId}` room
described in `DRIVER_APP_SOCKET_GUIDE.md` §2. Nothing new to subscribe to; if the socket
connection from that doc is already working, this event is already reaching you.

## 3. Event name and payload

```
event: trip-status-updated
payload: <full trip object, identical shape to GET /api/trips/{id}>
```

Same shape covered in `DRIVER_APP_POST_CONFIRM_NEXT_STEPS.md` §2 — flat `driverId`/`driverName`/
`driverPhone`/`truckId`/`truckReg` fields (no nested `driver: {...}` object), plus `id`,
`bookingId`, `bookingNumber`, `status`, `pickup`/`drop` objects, `currentLocation`, `stops`,
`paymentStatus`, `timeline`, etc. — everything `GET /api/trips/{id}` already returns.

## 4. Integrating on the client side

Match the payload's `bookingId` against whatever booking the client is currently viewing (the
tracking screen), then update the status badge/label immediately:

```dart
socket.on('trip-status-updated', (data) {
  final trip = Map<String, dynamic>.from(data);
  if (trip['bookingId'] != currentBookingId) return;

  setState(() {
    currentTripStatus = trip['status']; // e.g. "picked_up"
  });
  // Also worth immediately re-fetching GET /api/bookings/{id}/track right here — the trip
  // payload's currentLocation is a DIFFERENT, trip-scoped location field (used for the
  // pickup/delivered proximity gate) than what the tracking endpoint's driverLat/driverLng
  // return (the driver's live device position). Don't copy trip.currentLocation into your
  // map marker directly — trigger a fresh track-endpoint call instead, same as the reference
  // web client does (see gadidosti-client/src/pages/TrackShipment.jsx's
  // useTripStatusSocket usage — it bumps a refresh flag to re-poll rather than reusing the
  // socket payload's location field for this exact reason).
});
```

This is what removes the client's need to reload the tracking screen when the driver marks
something picked up/delivered/etc.

## 5. Integrating on the driver/broker side

**Driver app** — match on the trip's own `id` against whatever trip is currently loaded (the
active-trip/"My Trip" screen), then reload the full trip (simplest and safest — a status change
can affect several derived things at once: the delivery-completion flow's step, the stop
checklist, the timeline):

```dart
socket.on('trip-status-updated', (data) {
  final trip = Map<String, dynamic>.from(data);
  if (trip['id'] != currentTripId) return;
  reloadActiveTrip(); // re-call GET /api/trips/active or GET /api/trips/{id}
});
```

This is the piece that matters most for the location/active-trip bug already diagnosed in
`DRIVER_APP_LOCATION_ACTIVE_TRIP_FIX.md` — once that fix lands (tracking lifecycle no longer tied
to a shell that gets disposed on navigation), this event is what makes the trip screen actually
reflect status changes live instead of needing a manual refresh.

**Broker app** — same idea, matched on `bookingId` against whichever job/booking detail screen is
open, triggered as a **silent** refresh (don't show a full-page loading spinner for a background
push — just quietly re-fetch and update the already-rendered screen):

```dart
socket.on('trip-status-updated', (data) {
  final trip = Map<String, dynamic>.from(data);
  if (trip['bookingId'] != currentJobBookingId) return;
  reloadJobDetail(silent: true);
});
```

## 6. Still keep polling as a fallback

This doesn't replace the polling already recommended elsewhere (`GET /api/trips/active` on
screen focus/app resume, per `DRIVER_TRIP_FLOW_GUIDE.md` §6) — sockets can still drop (backgrounded
app, flaky connection). This event just makes updates arrive instantly when the socket is
healthy; the poll is still the safety net for when it isn't.
