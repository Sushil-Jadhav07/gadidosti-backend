# Negotiation Updates — 2-Counter Limit & "Find Another Truck" on a Dead Direct-Pick

Two related changes to the direct client↔driver negotiation (`driver_requests`) and the
broker-broadcast negotiation (`job_requests`). Backend + both web apps are done; this doc covers
what the Flutter app (`SSK_Cargo`) needs — I read the actual Flutter negotiation code (not
guessing) to find exactly what's missing versus what's already fine.

---

## 1. Two counter-offers per side, then Accept/Decline only

**What changed server-side**: `PATCH /driver-requests/:id/counter`, `/client-counter`, and the
equivalent `/jobs/requests/:id/counter`, `/client-counter` now reject a 3rd counter-offer from
the same side with a `400`:
```json
{ "success": false, "message": "You've reached the limit of 2 counter-offers — please accept or decline instead" }
```
The count is derived from `offer_history` (excluding its first entry, which is always the
starting ask, not a real counter — see `driverRequest.controller.js`'s `MAX_COUNTERS_PER_SIDE`,
`countClientCounters`, `countRespondentCounters`).

Every driver-request/job-request API response now also includes:
```json
{
  "clientCountersUsed": 1,
  "respondentCountersUsed": 2,
  "maxCountersPerSide": 2
}
```
`respondentCountersUsed` counts the driver's or broker's counters together (whichever one is
actually negotiating) — mirrors `offerHistory`'s existing `by: 'client'|'driver'|'broker'` shape.

**What Flutter needs — driver side**:

`SSK_Cargo/lib/features/driver/presentation/screens/driver_order_accepted_screen.dart` has the
driver's counter flow (a slider + "Send counter" button, ~line 1362, calling
`counterDriverRequestAsDriver`). It doesn't currently check any limit before showing that button.
Add a check using the new `respondentCountersUsed`/`maxCountersPerSide` fields (thread them into
`DriverRequestItem` in `driver_request_models.dart` the same way `offerHistory`/`offerCount`
already are, ~line 79) and hide/disable "Send counter" once the limit's reached, same as the web
driver app does.

**What Flutter needs — client side, and one thing to double-check with your own team first**:

`client_flow_widgets.dart`'s negotiation sheet (`_buildWaitingView`, ~line 5216-5225) already
renders `_NegotiationActionButtons` with **`canCounter: false` hardcoded** — meaning right now,
a Flutter client can only Accept or Reject a driver's counter-offer, never counter back at all.
That's *more* restrictive than the new 2-per-side web limit (web allows the client 2 counters;
Flutter currently allows 0 here). I'm not changing this — it may be intentional — but flagging it
since it's a real behavior difference from the web client, in case you want them to match.

---

## 2. Dead direct-pick sends the client back to Step 3 (truck selection) — not the broker flow

**Context**: on web, when the driver a client picked directly declines (or times out and their
broker also declines/times out), the client used to fall into the broker-broadcast screen. That's
changed — they now go back to Step 3 to pick a different truck, on the *same* booking (which
never left `status: 'pending'`), not a new one. See `docs/` — no new doc needed for the web side,
this section is Flutter-specific.

**What I found in Flutter — this is a real gap, not just a missing button**:

`client_flow_widgets.dart:2799-2806`, the code that handles the negotiation modal closing:
```dart
if (!mounted || outcome == null) {
  return;
}
if (!outcome.accepted) {
  _goToClientHome();
  return;
}
```
**Any non-accepted outcome — including a plain decline — currently sends the client all the way
back to the client's home screen**, not just back to truck selection. That's actually a bigger
drop than what the web app used to do (web at least kept them mid-wizard on the same booking).
The client loses their pickup/drop/draft and has to start the whole booking over.

The negotiation sheet itself already returns a structured outcome
(`_DirectNegotiationOutcome.rejected()`, `client_flow_widgets.dart:4986`) exactly at the point a
decline happens — so the plumbing to react differently is already there, it just needs to *do*
something other than `_goToClientHome()`. What "back to truck selection" should look like in this
screen depends on how your truck-search step is structured (I saw this negotiation sheet is
opened via `_openNegotiationSheet`/`showModalBottomSheet` from what looks like the truck-list
step itself, so simply *not* navigating away — letting the modal close back onto whatever
screen opened it — may already be enough, rather than needing a new destination at all. Worth
confirming against your own screen flow rather than me guessing further from outside it).

---

## Quick checklist

| Item | File | Notes |
|---|---|---|
| Hide "Send counter" once the driver's side hits the limit | `driver_order_accepted_screen.dart` (~1362), `driver_request_models.dart` (~79) | New fields already in the API response, just need parsing + a check |
| Client can't counter a driver's counter at all today | `client_flow_widgets.dart:5220` (`canCounter: false`) | Not touched — flagging as a possible intentional gap vs. web's 2-counter allowance |
| Decline sends the client to Home instead of back to truck search | `client_flow_widgets.dart:2799-2806` | Real gap — `_goToClientHome()` fires on every non-accept outcome, not just a true dead-end |
