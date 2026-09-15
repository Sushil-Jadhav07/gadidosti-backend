# Express Delivery & Delivery SLA — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Two related backend changes just shipped. Both are additive —
nothing here breaks the app as it works today; every new field is optional and every new
endpoint parameter defaults to today's behavior.

---

## 1. Delivery SLA (applies to every trip automatically — nothing to build unless you want to)

Every trip now gets a distance-tiered "expected delivery time" (e.g. up to 300km → 36h,
300–1000km → 48h, beyond → 120h — all admin-configurable) computed once at trip creation. If a
trip runs over it, the backend automatically adds a delay charge to the booking — you don't
compute or send anything for this, same as the existing halting-charge feature (a distinct,
separate metric — time spent stopped mid-trip, not total journey time).

If you want to surface it (optional): booking and trip objects now both carry
`expectedDeliveryHours` (number, or null until a trip exists), `slaOverageHours`, and
`slaOverageCharge` (both default `0`). Same idea as `haltingHours`/`haltingCharge` if you've
already looked at those from the earlier halting-charge guide.

---

## 2. Express Delivery — intra-city only, real work if you want to offer it

**What it is**: an opt-in, faster (and costlier) delivery tier a client can choose at booking
time — **only ever available for intra-city bookings** (confirmed scope; sending it for an
inter-city booking gets rejected). It adds a surcharge to the normal price (default +20%,
admin-configurable) and tightens the delivery deadline (default 40% faster than the normal SLA
above, also admin-configurable), with an optional informational "includes transit insurance"
note (no real insurance/claims processing behind it — just a badge).

**New request field** — both `POST /api/bookings/quote` and `POST /api/bookings` now accept an
optional `is_express: boolean` in the body. Only meaningful when `transport_type` is `'intra'`
(or omitted, which defaults to intra) — sending `is_express: true` together with
`transport_type: 'inter'` returns a **422**.

**New response fields** — the pricing-quote response (intra-city branch) now includes:
```json
{
  "isExpress": true,
  "expressSurcharge": 4000,
  "expectedDeliveryHours": 21.6,
  "expressInsuranceIncluded": true
}
```
(all zero/false when `is_express` wasn't sent). Don't hardcode the 20%/40% figures anywhere —
both are admin-configurable and can change; always read `expressSurcharge`/`expectedDeliveryHours`
back from the response instead.

Booking objects (`GET /api/bookings/:id` etc.) now also carry `isExpress: boolean`.

**What to build, if you want Express in the app**: a toggle somewhere in your booking-creation
flow, shown only when the booking is intra-city, that adds `is_express: true` to both the quote
and create-booking requests and displays the returned surcharge/deadline before the client
confirms. On the booking-detail/tracking screen, show an "Express" badge when `isExpress` is
true (the web client and driver/broker web apps both just gained the same badge, if you want a
visual reference for tone/placement — same repos this guide's sibling docs describe).
