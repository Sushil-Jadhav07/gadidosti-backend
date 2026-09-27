# Truck Type Retaxonomy + Pricing Rebuild — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Checked against the actual `SSK_Cargo/lib` code — this one needs
real work, more than the previous guides. The truck-type picker here is fully hardcoded and
disconnected from the backend, in a way the web app's equivalent already wasn't.

## What changed on the backend

1. **`truck_category` retaxonomy.** The old 4-value taxonomy (`small`/`medium`/`large`/`part`)
   is replaced, for anything describing a truck's actual physical size, by 8 specific types:
   `3_wheeler`, `tata_ace`, `pickup_8ft`, `pickup_10ft`, `14ft`, `17ft`, `19ft`, `22ft`. Additive
   in the DB — old trucks keep their old category, nothing is force-migrated. `part` (part-load
   booking) is untouched, it was never a truck size to begin with.

2. **`GET /api/config/vehicle-types`** now returns these 8 new types + `part`, each shaped
   `{ id, name, capacity, basePrice, featured?, savePercent? }` — `basePrice` is that type's
   minimum fare, sourced live from the pricing config (not hardcoded). This is the same endpoint
   that already existed before this change; only its contents changed.

3. **New pricing engine.** Fares are now `minimumFare` (a floor — never charged less) plus a
   distance-tiered per-km rate, looked up per truck type (bands: 25/50/100/300/1000/1500/2000km,
   then open-ended). `POST /api/bookings/quote`'s response shape is **unchanged** — same
   `baseFare`/`distanceFare`/`subtotal`/`total` fields as before. Three new *optional* fields
   were added (`ratePerKm`, `minimumFareApplied`, `regionApplied`) — nothing existing was removed.

4. A new optional `drop_state` field on the quote/booking payload enables 3 named-region flat-rate
   overrides (South-East/Guwahati Side/Kerala). Omitting it just means regional pricing never
   applies — always falls back to normal distance pricing, which is always correct on its own.

## The gap this app currently has

**The truck-type picker is a hardcoded 4-item list, completely disconnected from the backend.**

`features/client/presentation/widgets/client_flow_widgets.dart:787-816` — the client booking
flow's truck-selection step (this app's equivalent of the web `BookTruck.jsx` Step 3) is driven
entirely by a local `const vehicleOptions = <VehicleOption>[...]` list: Small truck / Medium
truck / Big truck / Truck pooling, with hardcoded prices (`'₹899'` etc.) and asset paths. It
never calls the backend for this list at all — the 8 new types don't exist here in any form.

**`getVehicleTypes()` already exists in `api_client.dart:359-364` — but it's dead code.** Nothing
calls it. This is the one piece that's *already built* and just needs wiring up (see "What to
build" below) — you don't need to write a new API method, just start using the one that's there.

**Three separate, duplicated `_truckCategoryForVehicle(label)` functions**, each converting the
picker's free-text label back into a `truck_category` string via `.contains()` string matching —
and they disagree with each other on the fallback value:
- `client_flow_widgets.dart:6518-6524` → falls back to `'pooling'`
- `broker/presentation/screens/add_truck_screen.dart:560-566` → falls back to `'part'`
- `broker/presentation/screens/add_vehicle_screen.dart:502-508` → same as above, but this whole
  screen is dead code (`AddVehicleScreen` isn't referenced anywhere else in `lib/` — only
  `AddTruckScreen` is wired into the router). Ignore this file.

None of the three know about any of the 8 new type strings.

**A second, separate bug — the same class as the old web `truckImages.js` issue.**
`broker/presentation/widgets/broker_flow_widgets.dart:1074-1098` maps a truck's `category` to a
display label and asset icon for the broker's fleet list (trucks loaded from the backend — so
this *will* see the new category values, e.g. for a truck registered via web/admin):
```dart
String _labelFromCategory(String category) {
  switch (category.toLowerCase()) {
    case 'small': return 'Small truck';
    case 'medium': return 'Medium truck';
    case 'large': case 'big': return 'Big truck';
    case 'part': return 'Part load';
    default: return 'Truck';
  }
}
String _assetPathForLabel(String label) {
  final text = label.toLowerCase();
  if (text.contains('small')) return 'assets/trucks/small truck.png';
  if (text.contains('medium')) return 'assets/trucks/medium truck.png';
  if (text.contains('big') || text.contains('large')) return 'assets/trucks/big truck.png';
  return 'assets/trucks/truck pooling.png';
}
```
Any of the 8 new categories falls through both switches to the generic `'Truck'` label, which
then resolves to the **"truck pooling" icon** — a 17ft truck would silently show the shared-load
icon in the broker's own fleet list. `pubspec.yaml:82-88` only bundles 4 truck images total (no
per-type art exists), so this isn't a "add more assets" fix on its own — see below.

**A third, unrelated hardcoded-3-tier spot**: `ClientIntraCityPricing` in
`features/client/data/client_booking_models.dart:85-103` has exactly 3 named fields
(`large`/`small`/`medium`), fed by a separate `getAdminPricing` call
(`client_bookings_controller.dart:35-51`) used only to show a starting price on the picker
cards. This becomes redundant once you switch to `getVehicleTypes()` (see below) — that
response already carries the correct per-type `basePrice` directly, no separate call needed.

**What's already safe, no action needed:**
- Quote/estimate parsing (`_readMoneyValue`/`_readDoubleValue` in `client_flow_widgets.dart`)
  reads by exact key name from a candidate list and tolerates unknown fields — the 3 new
  optional response fields are automatically ignored, won't break anything.
- `quoteBooking()` in `api_client.dart:204-235` is dead code (nothing calls it) —
  `estimatePricing()` (line 871) is the one actually in use, for the payload builder mentioned
  below.
- No `drop_state` is sent anywhere currently — fine, regional pricing just won't trigger from
  this app until/unless you add it (optional, see last section).

## What to build

1. **Wire up `getVehicleTypes()`.** Fetch it once (app start, or when the truck-selection step
   first mounts) and build the picker's option list from the response instead of the hardcoded
   `vehicleOptions` const — `id` → category to send, `name` → display label, `capacity` →
   subtitle, `basePrice` → the price shown on the card (format as currency; `null` for `part`,
   same as today's "Truck pooling" card already has no real price driving it). This single
   change fixes the picker, the price display, *and* removes the need for the separate
   `getAdminPricing`/`ClientIntraCityPricing` call for this screen.

2. **Delete the three `_truckCategoryForVehicle` functions.** Once options come from the API,
   each `VehicleOption` should just carry its own `id` (the real category string) directly —
   no more guessing a category back out of a free-text label via `.contains()`. Use that `id`
   wherever `_truckCategoryForVehicle(...)` is called today (`client_flow_widgets.dart:3226`,
   `add_truck_screen.dart`'s submit payload).

3. **Fix the broker fleet-list icon/label mapping** (`broker_flow_widgets.dart:1074-1098`). No
   per-type art exists in this app any more than it did on web, so an exact fix needs new
   assets; a same-effort-as-web fallback in the meantime: extend the `switch` to cover all 8 new
   values, mapping each to whichever of the 4 existing images is closest in size (e.g.
   `3_wheeler`/`tata_ace`/`pickup_8ft` → small truck art, `pickup_10ft`/`14ft` → medium,
   `17ft`/`19ft`/`22ft` → big truck) rather than falling through to "truck pooling" for
   everything unrecognized. Matches how `gadidosti-client`'s `truckImages.js` was fixed on web —
   same reasoning, same available-asset constraint.

4. **`add_truck_screen.dart`**: same fix as #1/#2 — fetch `getVehicleTypes()` for its picker
   grid instead of the hardcoded `vehicleOptions`, submit the option's `id` directly as
   `category`.

5. **Not urgent, optional**: if you want the 3 named-region rates to ever apply for bookings
   made from this app, capture the drop address's state and add it as `drop_state` to the
   payload built in `_estimateBookingAmount` (`client_flow_widgets.dart:3224-3250`, the
   `estimatePricing()` payload) and to `_bookingPayload()` (`:3398-3427`, for `createBooking`).
   Omitting this is completely fine — it's exactly today's behavior already, and the web client
   hasn't finished wiring this up either yet (it captures city, not full state, from its address
   autocomplete), so there's no urgency to be first here.
