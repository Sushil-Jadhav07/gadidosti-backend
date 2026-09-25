# Multi-Offer Driver Negotiation — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Checked against the actual `SSK_Cargo/lib` code — this app
already has almost everything needed for this, just wired to the wrong list.

## What changed

Two things, both in `gadidosti-backend`:

1. **The per-side counter-offer cap is gone.** `driverRequest.controller.js`'s
   `MAX_COUNTERS_PER_SIDE` used to be `2` — both the client and the driver/broker could only
   counter twice each before being forced to accept or decline. It's now `null` (no limit).
   Negotiation on a single offer can now go back and forth indefinitely until the client accepts
   one specific offer.
2. **The client-facing web app now shows every nearby driver's offer at once, not just one.**
   Previously, when a booking broadcasts to N nearby drivers (`search_mode='truck'`), the web
   app auto-picked whichever single `driver_requests` row was "most interesting" (via a
   `RANK` scheme) and only ever showed that one, hiding the rest. It's been rebuilt so the
   client sees **every** live (non-declined) driver's offer as its own independently-negotiable
   card — accept/counter/decline each one separately — and only escalates to a single "confirmed"
   view once one of them is actually fully accepted (both sides committed). The backend already
   auto-declines every other open offer for that booking the moment one is accepted
   (`finalizeDriverRequest` — unchanged by this work, just now relied on more directly).

## The gap this app currently has

This app already builds the "show every offer as its own card, act on each independently" UI —
**for broker offers**, not driver offers. It's sitting right next to the driver-request code that
needs the same treatment.

**`features/client/presentation/screens/tracking_details_screen.dart`**:

- `_loadNegotiation()` (~line 2515) fetches driver-request state via
  `api.getDriverRequestByBooking(bookingId)` → `GET /api/driver-requests/booking/:bookingId`,
  which — same as the web app's old behavior — only ever returns **one** arbitrary
  `driver_requests` row for the booking, not the full fan-out. That single result is stored in
  `_driverRequest` (~line 2545), a single nullable field, not a list.
- Right after that, it also calls `api.getBookingOffers(bookingId)` →
  `GET /api/bookings/:id/offers`, which is a **completely different thing** —
  `job.controller.js`'s `getBookingOffers`, i.e. broker offers (`job_requests`), not driver
  offers (`driver_requests`) at all. Result goes into `_offers`, a `List<ClientBookingOffer>`.
- The UI (~line 2895–2946) renders `_driverRequest` as a single `_NegotiationCard` under a
  "Direct truck request" section, then separately renders `_offers.map(...)` as one
  `_NegotiationCard` **per broker offer** under a "Broker offers" section — each with its own
  Accept/Counter/Decline wired to that specific offer
  (`_clientActionButtonsForOffer(offer)`, ~line 3038, calling `_acceptOffer(offer)` /
  `_counterOffer(offer)` / `_rejectOffer(offer)` — all parameterized by the specific offer).
- The driver-request buttons, by contrast (`_clientActionButtonsForDriverRequest`, ~line 3006),
  call `_acceptDriverRequest()` / `_rejectDriverRequest()` with **no parameter** — they always
  act on the single `_driverRequest` field, because there was never more than one to choose from.

So: no endpoint call anywhere in this app hits `GET /api/bookings/:id/driver-requests` (the
plural, full-fan-out-list endpoint the web app's new UI uses) — it's simply never been called
from Flutter. `getBookingOffers` looked like it might be the same thing at a glance, but it's a
different feature (brokers, not drivers).

## What to build

The shape of the fix is: **copy the `_offers` pattern that already exists for broker offers, and
point it at driver requests instead.**

1. **New API method**, `api_client.dart` (next to `getDriverRequestByBooking` at ~line 536):
   ```dart
   Future<Map<String, dynamic>> getDriverRequestsForBooking({
     required String accessToken,
     required String bookingId,
   }) async {
     return _request(
       () => _dio.get<Map<String, dynamic>>(
         '/api/bookings/$bookingId/driver-requests',
         options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
       ),
     );
   }
   ```
   Response shape: `{ success, data: { requests: [...] } }` — same per-item shape
   `getDriverRequestByBooking` already returns one of, so `ClientBookingOffer.fromJson` (in
   `client_booking_models.dart`) should parse each array item as-is with **no model changes
   needed** — it already reads flexible field-name aliases and has a `raw` fallback.

2. **In `_loadNegotiation()`**: replace (or run alongside, if you want to keep the direct-request
   creation flow's single result as a fallback) the singular `getDriverRequestByBooking` call
   with the new plural one, storing the result as `List<ClientBookingOffer> _driverRequests`
   instead of a single `_driverRequest`. Filter out `status == 'declined'` rows the same way the
   web app does before rendering.

3. **Render `_driverRequests` the same way `_offers` is already rendered** (~line 2915–2946):
   a `_NegotiationSectionTitle` ("Nearby driver offers"), an empty state if none yet, then
   `_driverRequests.map(...)` → one `_NegotiationCard` per request.

4. **Parameterize the driver action methods.** `_acceptDriverRequest()` / `_rejectDriverRequest()`
   / `_counterDriverRequest()` currently close over the single `_driverRequest` field. Change
   them to take the specific `ClientBookingOffer request` as a parameter (mirroring
   `_acceptOffer(offer)` / `_counterOffer(offer)` / `_rejectOffer(offer)` exactly), and build a
   `_clientActionButtonsForDriverRequests(request)` that's the driver-side twin of the existing
   `_clientActionButtonsForOffer(offer)` (~line 3038) — same Accept/Counter/Decline-vs-
   Confirm/Decline branching logic already written there, just calling the driver-request API
   methods instead of the offer ones.

5. **The per-side counter cap is gone** — nothing in this app currently hardcodes a counter
   limit (no `maxCounters`/limit-related UI found), so no changes needed there; negotiation on
   each card can just continue indefinitely until the client accepts one.

6. **On accept**: no special handling needed beyond what already exists — once one
   `driver_requests` row reaches `status == 'accepted'`, the backend auto-declines every other
   open one for that booking. The next poll/refresh will reflect all the sibling cards flipping
   to `declined` (and disappearing from the filtered list) on its own.

Not required, but worth doing if there's time: `ClientBookingOffer` doesn't currently parse
`offer_history` — the web app shows a collapsible "Negotiation history (N)" list per card using
that field. Optional nice-to-have, not needed for the core fix.
