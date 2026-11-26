# GPS Owner Role & GPS Tracking (Bolt Pull API) — Reference

What the new `gps_owner` role is, how to create one, and the full GPS tracking API it (and
admin/staff) use — the vendor feed itself, and the new truck-linking feature.

## 1. The `gps_owner` role

A third admin-dashboard account type alongside `admin` and `staff` — mechanically identical to
`staff` (same `page_permissions` column, same `requireAdminPage`/`hasPageAccess` gating), just a
distinct label for an account meant to only ever be granted the **Live Tracking** page. There's no
separate permission system for it; it's `staff` in every way except the name, so whoever creates
one is expected to grant it exactly one page.

### Creating one

Admin dashboard → Users → Add User → pick **GPS Owner** (alongside Staff/Admin) → fill in
name/phone/email/password. Same flow as creating a staff account — active immediately, no OTP.

Backend: `POST /api/auth/admin/register` with `role: "gps_owner"` (admin-only, same endpoint
staff/admin accounts already use).

### Granting page access

Same place as staff: Users → click the account → **Page Access** section (only shown for
`staff`/`gps_owner` accounts) → check **Live Tracking** → Save Access. Nothing is granted by
default; an admin has to explicitly check it, same as any staff permission.

Backend: `PATCH /api/admin/users/{id}/permissions` with `{ "pages": ["tracking"] }` — admin-only,
works identically for `staff` and `gps_owner` targets, rejected (`400`) for any other role.

### What it can actually do (once granted `tracking`)

- View the live position (list + map) of only the devices an admin has explicitly granted it —
  see **Device Access** below. Not the whole fleet, unlike admin/staff.
- See each granted device's connection status (`online`/`offline`) and last-seen time.
- See which truck a granted device is linked to (if any) — but **cannot** change that link;
  linking a device to a truck in the first place is admin/staff only (see below).

It gets nothing else — no Trucks page, no Users page, no Bookings, nothing beyond what's
explicitly granted, exactly like a restricted staff account.

### Device Access — scoping which devices a gps_owner can see

Unlike `staff`, a `gps_owner` isn't just page-scoped — it's also scoped to a specific *set of GPS
devices*, admin-granted, by device IMEI. Users → click the gps_owner account → **Device Access**
section (only shown for `gps_owner` accounts, right below Page Access) → check which devices this
account should see → Save Device Access. Nothing is granted by default — an unconfigured
gps_owner sees zero devices, not the whole fleet.

This is deliberately **not** scoped through our own `trucks` records — an earlier version
required a device to already be linked to one of our trucks (see the link-truck feature below)
before it could be granted, which was confusing in practice: Live Tracking clearly shows devices
(the vendor's own tracker names often already look like a registration, e.g. `"HR46G8875"`), but
none of them had actually been linked yet, so that picker showed nothing despite devices
obviously existing. Device Access instead lists exactly the same devices `GET
/api/tracking/devices` already shows — the same list an admin sees on Live Tracking — with no
linking prerequisite at all.

Backend: `GET`/`PATCH /api/admin/users/{id}/gps-devices` (admin-only), `{ "device_imeis": [...] }`
— replaces the full granted set, same "always send the complete desired list" convention as page
permissions. Stored in a `gps_owner_devices` table (gps_owner_id, device_imei).

Every tracking endpoint (list, by-name, by-IMEI) filters to this set for a `gps_owner` caller —
admin/staff are never scoped by this table at all. A `gps_owner` requesting a device outside their
granted set by direct IMEI/name gets a plain `404`, identical to a genuinely nonexistent device —
never a `403` that would confirm the device exists on the fleet at all.

## 2. The GPS tracking API (Roadcast "Bolt Pull API")

One fixed third-party vendor feed (Roadcast Tech Solutions), not a swappable provider — every
truck's physical GPS hardware reports into Roadcast's platform, and we poll it. Single shared
account for the whole fleet (`BOLT_API_USERNAME`/`BOLT_API_PASSWORD` in `.env`), not per-user
credentials — there's no concept of "my devices" vs. "someone else's" on the vendor side at all.

`src/providers/tracking/BoltTrackingProvider.js` wraps the vendor's pull endpoint
(`pullapi-s1.track360.co.in` — note **s1**, not s2; that was the actual cause of a previously-seen
"User not found" vendor error, not a credentials problem).

### Endpoints (all authenticated; `admin`/`staff`/`gps_owner`, gated by the `tracking` page)

| Endpoint | What it returns |
|---|---|
| `GET /api/tracking/devices` | Every device (admin/staff) or only the gps_owner's granted ones |
| `GET /api/tracking/devices/name/{name}` | One device by tracker name (e.g. `"DL1AA1100"`) |
| `GET /api/tracking/devices/imei/{imei}` | One device by vehicle IMEI |

Each device object now also carries, regardless of which of the three endpoints returned it:
```json
{ "truckId": "uuid-or-null", "truckRegistration": "MH12AB1234-or-null" }
```
— whichever of our trucks (if any) this IMEI is linked to (see below). `null`/`null` if it isn't
linked to anything yet.

**Caching / offline fallback:** every successful vendor read is cached into
`tracking_last_known` (keyed by IMEI). If the vendor call itself fails, these three endpoints fall
back to the cached row instead of erroring outright — the response then includes
`"source": "cached"` and the row's own `lastSeenAt`, which is what the "Live tracking is
unavailable — showing last known position" banner in the admin UI is driven off of. This is the
closest thing to a "device health" signal today: a device that's actually gone dark long enough
shows up this way instead of with a fresh position.

### New: linking a device to a truck (admin/staff only — not gps_owner)

A separate, purely optional record-keeping feature — "which of our trucks has this physical
device mounted on it" — entirely independent of a gps_owner's own visibility (that's Device
Access above, scoped by raw IMEI regardless of whether a truck link exists).

```
PATCH /api/tracking/devices/{imei}/link-truck
{ "registration": "MH12AB1234" }
```
- Admin/staff only — deliberately **not** callable by `gps_owner`, which would otherwise be able
  to expand its own effective reach by relinking devices onto trucks it already has access to.
- Looks the truck up by registration number (not a picker — there's no separate truck-browsing
  page this needs) and sets that truck's `gps_device_imei`/`gps_device_name` columns.
- A device already linked to a *different* truck is silently moved — the old truck's link is
  cleared first, so this never needs a separate "unlink old, then link new" round trip.
- **To unlink**: send `{ "registration": "" }` (or omit the field) — clears whatever truck
  currently has this IMEI, no-ops if nothing does.
- `404` if no truck matches that registration; `409` if a DB-level race somehow still collides
  (a unique index on `gps_device_imei` backs this, belt-and-braces alongside the explicit
  "move the old link first" step above).

Storage: `trucks.gps_device_imei` / `trucks.gps_device_name`, both nullable (most trucks have no
GPS unit yet), with a partial unique index (`WHERE gps_device_imei IS NOT NULL`) so two trucks can
never silently claim the same physical device while still allowing every truck without one to
leave the column `NULL`.

### Where this shows in the admin dashboard

- **Live Tracking** (list + map) — new "Linked Truck" column, searchable by registration too.
- **Device detail page** — new "Linked Truck" card: shows the current link (if any); admin/staff
  also get a registration-number input and Link/Change/Unlink buttons. A gps_owner sees the same
  card read-only — no input, no buttons, since that call would just 403 for them.

Nothing about the existing map/list/detail views changed otherwise — this is purely additive.
