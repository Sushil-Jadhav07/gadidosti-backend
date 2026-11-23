# Stuck Booking Escalation (30-min timeout) — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Written without access to the current `SSK_Cargo` source (same
situation as the other guides in this folder) — no file/line references, just the backend
contract and what the web apps already do with it.

## The problem this closes

A booking created via "Find Truck"/"Part Truck" (`search_mode: "truck"` or `"part_load"`), a
single-broker pick, or the legacy broker-broadcast fallback could sit in `status: "pending"`
forever if nobody ever responded — no admin alert, no widening of the search, nothing but the
client manually tapping "Search Again". A real booking sat unresolved for 3 days in production
before this was caught.

## What runs now (backend-only, nothing to build unless noted)

Every minute, a sweep (`cron/bookingSearchStuckSweep.js`) checks for any booking still `pending`
**30+ minutes** after creation that hasn't been flagged yet:

1. Notifies every admin/staff account (in-app notification + push — automatic, nothing the app
   needs to call).
2. For `search_mode: "truck"` or `"part_load"` only: widens `search_radius_km` to
   `min(current * 2, 150)` km, persists that back onto the booking, and re-broadcasts to any
   newly-in-range driver who wasn't a candidate at the original radius (same dedup rule as a
   manual "Search Again" — a driver with an already-live, non-declined request isn't re-notified).
3. Marks the booking so this never fires twice for the same one.

This is entirely server-driven — no new call for `SSK_Cargo` to make. Two things change in data
you already read, though:

### 1. `search_radius_km` can change under you

If your Find Truck screen displays "searching within Xkm" (the way `gadidosti-client`'s
`FindTruckSearch.jsx` does), that value can jump upward mid-search once this fires. Keep reading
it from the booking/driver-requests response rather than caching the value you got at search
start.

### 2. New field: `searchDelayed` on `GET /api/bookings/{id}/driver-requests`

```json
{ "requests": [...], "bookingStatus": "pending", "searchDelayed": true }
```
`true` once the 30-minute escalation has actually fired for this booking (server-confirmed, not a
client-side guess). `gadidosti-client` shows an extra reassurance line when this flips true,
layered on top of its existing client-only "still no driver yet" message (which is just a local
60-second elapsed-time heuristic with no server backing):

> "This is taking longer than usual — we've widened the search area and our team has been
> notified to help find you a truck."

If `SSK_Cargo` has its own waiting/searching screen for this flow, add the same kind of message
gated on this field — don't try to re-derive "has this been escalated" from elapsed time on
device, since that resets on every app restart and was exactly the gap that let a booking sit
unnoticed for days with the client's own screen still looking like a fresh, normal search.

## Nothing else to build

If `SSK_Cargo` doesn't have a Find Truck waiting screen at all yet, there's nothing here to add —
this guide is just keeping an existing one in sync, same as every other guide in this folder.
