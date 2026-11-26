# GPS Owner — Full Flow (Creation to Daily Use)

Everything that happens, in order, from an admin creating a `gps_owner` account to that account
using Live Tracking day-to-day — every screen involved and the exact API call behind it. For the
reference-style breakdown of each piece individually, see `GPS_OWNER_ROLE_AND_TRACKING_API.md`;
this doc is the same feature told as one straight-through walkthrough.

All endpoints are on the backend (`https://apigadidosti.asynk.in`), called from the admin
dashboard unless noted. Every response is `{ success, message, data }`.

---

## Step 1 — Admin creates the account

**UI:** Admin dashboard → **Users** → **Add User** → pick the **GPS Owner** button (next to
Staff/Admin) → fill in Name, Phone, Email, Password → **Create GPS Owner**.

**API:**
```
POST /api/auth/admin/register
Authorization: Bearer <admin's token>
{ "name": "Harsh", "phone": "9741852963", "email": "gps@gmail.com", "password": "...", "role": "gps_owner" }
```
Admin-only (`authorize('admin')`). Creates the account active immediately — no OTP, same as
staff/admin. At this point the account can log in, but can reach **nothing** — no pages, no
devices.

---

## Step 2 — Admin grants the Live Tracking page

Without this, the gps_owner can log in but every page (including Live Tracking) is blocked.

**UI:** Users → click the new account → **Page Access** section → check **Live Tracking** →
**Save Access**.

**API:**
```
PATCH /api/admin/users/{gps_owner_id}/permissions
Authorization: Bearer <admin's token>
{ "pages": ["tracking"] }
```
Admin-only. Replaces the account's full page list (not a merge) — this is the only thing checked,
so the result is exactly one page granted. The same endpoint staff accounts use; rejected (`400`)
for any role other than `staff`/`gps_owner`.

---

## Step 3 — Admin grants specific devices

Page access alone still shows **zero devices** — a gps_owner is also scoped to a specific set of
GPS trackers, admin-granted one by one.

**UI:** Same Users → account modal, scroll down to **Device Access** (only shown for gps_owner
accounts, right below Page Access):
1. The modal fetches the full device list (same one Live Tracking shows) and this account's
   current grants, in parallel:
   ```
   GET /api/tracking/devices              (admin's own token — full fleet, unscoped)
   GET /api/admin/users/{gps_owner_id}/gps-devices
   ```
2. Admin checks which devices (by name/IMEI/linked-truck, searchable) this account should see.
3. **Save Device Access**:
   ```
   PATCH /api/admin/users/{gps_owner_id}/gps-devices
   Authorization: Bearer <admin's token>
   { "device_imeis": ["864943044253561", "869727073796771"] }
   ```
   Admin-only. Replaces the full granted set (not a merge) — unchecking a device here actually
   removes its access, not just skips re-adding it. Granted straight by the vendor's own device
   IMEI — there's no requirement for a device to be linked to one of our truck records first (see
   the optional Step 3b below; it's unrelated).

At this point the gps_owner account can see exactly these devices and nothing else.

---

## Step 3b (optional, separate) — Admin links a device to one of our trucks

Pure record-keeping — "which of our trucks has this physical tracker mounted on it" — with no
bearing on what any gps_owner can see (that's entirely Step 3, by raw IMEI).

**UI:** Live Tracking → open a device → **Linked Truck** card → type the truck's registration
number → **Link** (or **Unlink**). Only admin/staff see these controls; a gps_owner viewing the
same device sees the current link read-only, no edit controls.

**API:**
```
PATCH /api/tracking/devices/{imei}/link-truck
Authorization: Bearer <admin or staff token>
{ "registration": "MH12AB1234" }
```
Looks the truck up by registration (not a picker) and sets `trucks.gps_device_imei`/
`gps_device_name`. Send `{ "registration": "" }` (or omit it) to unlink. A device already linked
to a different truck is moved automatically. `gps_owner` cannot call this at all (`authorize`
only allows `admin`/`staff`).

---

## Step 4 — The gps_owner logs in

**UI:** Same admin-dashboard login screen as everyone else.

**API:**
```
POST /api/auth/login
{ "email": "gps@gmail.com", "password": "..." }
→ { "user": { "role": "gps_owner", "page_permissions": ["tracking"], ... }, "tokens": {...} }
```
Same shared login endpoint every role uses. The sidebar renders from `page_permissions` — a
gps_owner with only `"tracking"` granted sees exactly one item: **Live Tracking**.

---

## Step 5 — The gps_owner uses Live Tracking

**List view** (`Live Tracking` in the sidebar):
```
GET /api/tracking/devices
Authorization: Bearer <gps_owner's token>
```
Same endpoint admin/staff use — but for a `gps_owner` caller, the backend filters the result down
to only the device IMEIs granted in Step 3. Each device still carries `truckId`/
`truckRegistration` if one happens to be linked (Step 3b), purely informational.

**Detail view** (clicking a device):
```
GET /api/tracking/devices/imei/{imei}
```
Same scoping applies — requesting an IMEI outside the granted set (by guessing a URL, say) comes
back a plain `404 Device not found`, identical to a genuinely nonexistent device. Never a `403`,
so this never confirms a device exists on the fleet at all to someone not granted it.

The **Linked Truck** card still shows here (read-only for this role) if Step 3b was ever done for
this device — a gps_owner can see which truck a device is on, just can't change that link.

---

## Full API reference, in the order used above

| # | Method & path | Who | Purpose |
|---|---|---|---|
| 1 | `POST /api/auth/admin/register` | admin | Create the gps_owner account (`role: "gps_owner"`) |
| 2 | `PATCH /api/admin/users/{id}/permissions` | admin | Grant the `tracking` page |
| 3 | `GET /api/tracking/devices` | admin | List all devices, to build the Device Access picker |
| 4 | `GET /api/admin/users/{id}/gps-devices` | admin | Fetch this account's current device grants |
| 5 | `PATCH /api/admin/users/{id}/gps-devices` | admin | Save the granted device IMEIs (replaces the full set) |
| 6 | `PATCH /api/tracking/devices/{imei}/link-truck` | admin/staff | *(optional, unrelated to visibility)* Record which truck a device is mounted on |
| 7 | `POST /api/auth/login` | gps_owner | Log in |
| 8 | `GET /api/tracking/devices` | gps_owner | List — filtered to granted devices only |
| 9 | `GET /api/tracking/devices/imei/{imei}` or `/name/{name}` | gps_owner | Device detail — `404` if not granted |

Rows 3–5 and 6 are both admin-side setup; rows 7–9 are what the gps_owner account itself ever
calls. Admin/staff calling rows 7–9 are never filtered — only a `gps_owner` caller is scoped.
