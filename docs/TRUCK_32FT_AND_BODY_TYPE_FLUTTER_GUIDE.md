# 32ft SXL/MXL + Open/Closed Truck Structure — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. This extends the truck-type system described in
`TRUCK_TYPE_RETAXONOMY_FLUTTER_GUIDE.md` — read that one first if the truck-type picker in this
app still isn't wired to `GET /api/config/vehicle-types`, since everything below assumes it is (or
will be) data-driven rather than a hardcoded list. **Note:** unlike that guide, this one was
written without access to the current `SSK_Cargo` source, so there are no file/line references
here — only the backend contract. Check whether the gaps that guide described (hardcoded picker,
the three `_truckCategoryForVehicle` functions, the broker fleet-list icon switch) are still there
before assuming any of this needs new wiring.

## What changed on the backend

1. **Two more truck sizes.** `truck_category` gains `32ft_sxl` (32ft SXL, 9 Ton) and `32ft_mxl`
   (32ft MXL, 18 Ton), additive on top of the existing 8 (`3_wheeler`, `tata_ace`, `pickup_8ft`,
   `pickup_10ft`, `14ft`, `17ft`, `19ft`, `22ft`) plus `part`. Same mechanism as the original
   retaxonomy — nothing is removed or renumbered, so **if this app's picker already fetches
   `GET /api/config/vehicle-types` instead of a hardcoded list, these two new cards just show up
   with no code change.** If it's still hardcoded, this is one more reason to fix that.

2. **A brand-new, independent field: `body_type`.** Not a size — a truck's physical structure,
   `"open"` or `"closed"`. Nullable everywhere (`null`/omitted = not specified, including every
   truck registered before this existed). Lives in two places:
   - `trucks.body_type` — set once when a truck is registered, editable afterward.
   - `bookings.truck_body_type` — optionally set by whoever is creating a booking, as a filter on
     top of `truck_category`.

3. **Where `body_type` is read/used:**
   - Truck create/update accept it and echo it back (`bodyType` in every truck JSON response).
   - `GET /api/vehicles/trucks/nearby` accepts it as an extra filter.
   - Booking creation accepts it and stores it; the **Find Truck broadcast** (the fan-out that
     notifies nearby available drivers) filters candidates by it, exactly like it already filters
     by `truck_category` — a booking with `truck_body_type: "closed"` only reaches drivers whose
     truck has `body_type: "closed"`. A booking that omits it matches regardless of body type, same
     as omitting `truck_category` matches any size.
   - **Pricing is unaffected** — `POST /api/bookings/quote` does not take or need `truck_body_type`;
     fare only depends on size category and distance, same as before.

## Endpoint contracts affected

### `POST /api/vehicles/trucks` / `PATCH /api/vehicles/trucks/:id`
New optional field in the request body:
```json
{ "body_type": "open" }   // or "closed", or omit entirely
```
`422` if present but not one of `open`/`closed`. Every truck response (create, update, get, list,
nearby, the driver's `me/truck`, the broker fleet-with-driver listing) now includes:
```json
{ "bodyType": "open" }   // or "closed", or null if never set
```

### `GET /api/vehicles/trucks/nearby`
New optional query param `body_type` (`open` | `closed`) — narrows results to trucks with that
exact structure, same way `truck_category`/`capacity` already narrow by size. Omit it to match any
structure. `422` on an invalid value.

### `POST /api/bookings`
New optional field:
```json
{ "truck_body_type": "closed" }   // or "open", or omit
```
`422` if present but not one of `open`/`closed`. Stored and returned on every booking read as
`truckBodyType`. Only meaningful for `search_mode: "truck"` (Find Truck) — it's accepted
regardless of search mode (so it can be set before the mode is chosen), but for `search_mode:
"broker"` bookings it's stored without affecting matching.

### Values reference
`truck_category` now accepts, in addition to the existing 9: `32ft_sxl`, `32ft_mxl`.
`body_type` / `truck_body_type` accept: `open`, `closed` (or omit/null — never required).

## What to build

1. **Truck registration/edit screen** (the Flutter equivalent of the web broker's Add/Edit Truck
   form, and admin's Register Truck if this app has an admin surface): add an optional "Truck
   Structure" picker — two options, Open Truck / Closed Truck, same visual weight as the truck-type
   picker but clearly optional (no default pre-selected, nothing blocks submission if left unset).
   Send it as `body_type` on create/update; leave it out entirely if the user didn't pick one
   (don't send an empty string).

2. **Client truck-search/booking step** (the equivalent of web's `BookTruck.jsx` Step 3, now
   showing the open/closed picker right under the size-category grid): add the same optional
   Open/Closed picker there. Send the selection as `truck_body_type` on `POST /api/bookings` —
   again, omit it rather than send a falsy value if the user leaves it unset. Don't add it to the
   quote/estimate call; pricing doesn't use it.

3. **Fleet list / truck detail display**: show the structure (e.g. a small "Open" / "Closed" tag
   next to the size label) wherever a truck's details are already shown, falling back to nothing
   (not "Unknown") when `bodyType` is `null` — most existing trucks won't have one set until their
   owner edits them.

4. **No new art/assets needed** for `32ft_sxl`/`32ft_mxl` or for body type — if this app has a
   per-category icon mapping (see the broker fleet-list switch described in the retaxonomy guide),
   route the two new size values to whichever existing "big truck" asset the 17/19/22ft values
   already use, same reasoning as that guide's icon fallback. Body type has no icon requirement at
   all — a text label/badge is enough.
