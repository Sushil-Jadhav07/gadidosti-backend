# Find Truck Search Screen — Map, Radar Ping, 2-Min Timeout — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Covers the last two rounds of UX work done on the web client's
"Find Truck" waiting screen. **Prerequisite check**: `SSK_Cargo`'s client role has no "Find Truck"
broadcast screen at all yet — confirmed by re-checking just now (zero matches anywhere under
`lib/features/client/` for `search_mode`, `driver-requests`, or anything fan-out-related). The
earlier `BOOK_LATER_AND_SEARCH_MODES_FLUTTER_GUIDE.md` already covers building that screen in the
first place (the `search_mode: 'truck'` request shape, `GET /api/bookings/:id/driver-requests`
polling, promoting to the single-driver negotiation card once one responds) — read that one
first if this screen doesn't exist yet. This guide is the next layer on top of it: what the web
client (`gadidosti-client/src/pages/FindTruckSearch.jsx`) now does visually while waiting, so you
can build the same experience rather than a bare spinner.

## 1. New fields on the driver-requests response

`GET /api/bookings/:id/driver-requests` — each item in `requests[]` now additionally carries
(added this round specifically so this screen could plot responding drivers on a map):

| Field | Type | Notes |
|---|---|---|
| `driverLat` | number \| null | The driver's last-reported GPS latitude. Null until their app has ever reported a location. |
| `driverLng` | number \| null | Same, longitude. |
| `driverHeading` | number \| null | Degrees, for rotating a vehicle icon to face travel direction. Null if never reported. |

Also needed, already existed but worth confirming you're capturing it: the booking's own pickup
coordinates. On the create-booking response and `GET /api/bookings/:id`, that's top-level
`pickupLat`/`pickupLng` (flat fields, not nested under `pickup`).

## 2. The live map

Reference implementation: `gadidosti-client/src/pages/FindTruckSearch.jsx`'s `DriverFanOutWaiting`
component. While waiting for a response:

- A marker at the booking's pickup point.
- A radius circle centered on pickup, radius = `searchRadiusKm * 1000` meters — visualizes what
  "notify every driver within N km" actually means, instead of just stating the number.
- One marker per still-**live** driver (`status !== 'declined'`) who has `driverLat`/`driverLng` —
  using the same rotating vehicle glyph you'd use anywhere else a truck appears on a map, not a
  generic pin. Each declined driver simply drops off the map, matching how it already drops out
  of the "Notified N drivers" count.

**Defensive note, learned the hard way on web**: never hand a marker or circle a lat/lng that
isn't a real finite number — the web client's Google Maps SDK throws
`InvalidValueError: not a LatLng or LatLngLiteral` and crashes the *entire* map (not just that one
marker) the moment one bad point sneaks in — this happened in production from a truck whose
location hadn't resolved yet. Filter every point for `lat`/`lng` both being actual finite numbers
immediately before handing it to the map widget, not just a null-check — a `driverLat` of
`NaN`/`"not-a-number"`/`undefined` all pass a naive null-check but still crash the renderer.

Layout-wise, the web version puts this map full-width and prominent at the top of the screen,
with the booking-summary/status text below it — not squeezed into a side column — mirroring how
Ola/Uber lay out their own "finding a driver" screen (map first and biggest, details below it).

## 3. The radar ping ("still searching" indicator)

A soft sonar-style animation — rings expanding outward from a center dot and fading, looped
continuously — overlaid on the map while actively waiting (hidden once a driver has actually
responded and this screen would hand off, or once every driver has declined).

Implementation note from the web version: this is **not** a real geo-anchored map circle that
animates its radius — animating a real map overlay at 60fps trashes performance and fights the
map's own bounds-fitting logic. It's a plain looping UI animation (on web, a CSS `@keyframes`
scaling 3 staggered rings from 1x→14x opacity 0.7→0, centered on the map *container*, not tied to
any lat/lng). In Flutter, the equivalent is a `Stack` with a couple of `AnimatedContainer`/
`TweenAnimationBuilder`-driven circles looping the same way, positioned centered over the map
widget — no map-coordinate math needed at all.

## 4. The 2-minute progress bar + timeout prompt

Purely a UX reassurance pattern, not a real deadline — the actual backend broadcast search never
stops and has no 2-minute cutoff of its own:

- A thin progress bar fills from 0% to 100% over 120 seconds since the screen started actively
  waiting (i.e. since first render, or since the user last dismissed the prompt below — see
  "Search Again"), with an elapsed `mm:ss` label next to it.
- The moment it hits 120s with still no driver response, show a prompt with two actions:
  - **Search Again** — purely resets the local 120-second timer/progress bar back to zero and
    keeps waiting. No backend call at all — the broadcast was never paused, so there's nothing to
    restart server-side.
  - **Cancel Search** — actually cancels the booking:
    ```
    PATCH /api/bookings/:id/cancel     (client)
    Body: { "reason": "<non-empty string>" }
    ```
    `reason` is **required** — a 422 otherwise. The web client sends a fixed default
    (`"No driver found within the search window"`) rather than prompting for one; do the same
    unless you want a reason-input step. Only works while the booking is still in a cancellable
    state (`pending`/`confirmed`/`assigned`/`en_route_pickup` — `pending` is what this screen's
    booking will be in, so this always succeeds from here barring a race). On success, the whole
    booking flow should reset to a blank first step — same idea as the web client's `resetFlow()`
    (clears the whole form/draft state, not just navigation) — so the user lands on a genuinely
    fresh "new trip" screen, not a stale form with old pickup/drop/etc. still filled in.

Both the progress bar and the timeout prompt should stop being shown the instant a driver actually
responds (this screen would hand off to the single-driver negotiation flow at that point anyway)
or every driver has declined (a different existing "no drivers accepted" state this screen already
has to handle per the earlier guide).
