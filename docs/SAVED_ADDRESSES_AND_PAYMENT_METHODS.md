# Saved Addresses & Payment Methods

Two new client-only resources, live on web (`gadidosti-client`'s Profile → Saved Addresses /
Payment Methods). This doc is the API contract plus what the Flutter app (`SSK_Cargo`) needs to
build the same thing — I checked, and it doesn't have an entry point for either yet.

---

## 1. Saved Addresses

A client's named pickup/drop points (`saved_addresses` table, `db/35client_saved_data.sql`),
picked via Google Places the same way `BookTruck.jsx`'s own pickup/drop fields work.

| Column | Notes |
|---|---|
| `label` | The name the client gives it — "Home", "Warehouse 2". Required. |
| `address` | The resolved, human-readable address. Required. |
| `floor` | Free-text floor/unit detail — Google's address data doesn't carry this, so it's a separate field entered alongside the map pick. Optional. |
| `lat` / `lng` | From the Google Places result. Nullable — you can technically save an address with no coordinates, but there's then nothing to prefill a map with. |
| `city` | Best-effort, from the place's `locality`/`administrative_area_level_2`. |
| `is_default` | Exactly one per client. The first address you ever save becomes default automatically; deleting the current default auto-promotes the most recently added remaining one. |

**Endpoints** (all `authenticate` + `authorize('client')`):

```
GET    /api/addresses                 → { addresses: [...] }
POST   /api/addresses                 → { address: {...} }
PATCH  /api/addresses/:id             → { address: {...} }   (any subset of label/address/floor/lat/lng/city)
PATCH  /api/addresses/:id/default     → { address: {...} }
DELETE /api/addresses/:id             → { }
```

Response shape per address:
```json
{
  "id": "uuid",
  "label": "Home",
  "address": "Anand Sagar Building, VSNL Colony, Mahim, Mumbai, Maharashtra 400016",
  "floor": "3rd Floor, Flat 402",
  "lat": 19.0412,
  "lng": 72.8397,
  "city": "Mumbai",
  "isDefault": true,
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Web implementation** (`gadidosti-client/src/pages/SavedAddresses.jsx`): a list screen + an
add/edit `BottomSheet` with the Name field, the same `PlacesAutocompleteInput` component
`BookTruck.jsx` uses for pickup/drop (Google search → resolves `{address, lat, lng, city}`), a
small live map preview of the pinned point once one's selected, and the Floor/Unit field. ⭐
sets default, trash removes.

**Not wired up yet — flagging, not guessing**: this is currently a standalone management page.
`BookTruck.jsx`'s own pickup/drop fields don't yet offer "pick from your saved addresses" — say
the word if you want that wired in too.

---

## 2. Payment Methods

A client's saved payment methods (`saved_payment_methods` table) for reuse at checkout.
**Important security note, since this is the part most likely to get copied into Flutter without
re-reading it**: there's no real payment gateway behind this app yet (see `PaymentSheet.jsx`'s
own header comment) — but this table is built as if there were, and enforces it:

> **Never send or store a full card number, expiry date, or CVV/PIN — only non-sensitive display
> data.** For a card, that means the brand/bank name and the *last 4 digits only*. The backend
> (`clientPreferences.controller.js`'s `sanitizeDetails`) strips anything resembling those keys
> from the `details` JSON even if a client somehow sent them — but don't rely on that backstop;
> the Flutter form itself should simply never ask for more than last-4.

| Column | Notes |
|---|---|
| `method_type` | One of `'upi' \| 'card' \| 'netbanking' \| 'wallet'`. |
| `label` | What's shown in the list — e.g. `"name@okhdfc"`, `"HDFC Bank •••• 4242"`, `"SBI"`, `"Paytm"`. |
| `details` | Small JSON blob of non-sensitive extras (`{"upi_id": "..."}`, `{"brand": "...", "last4": "..."}`, `{"bank": "..."}`, `{"wallet": "..."}`) — sanitized server-side regardless of what's sent. |
| `is_default` | Same auto-default/auto-promote behavior as addresses. |

**Endpoints**:
```
GET    /api/payment-methods                 → { paymentMethods: [...] }
POST   /api/payment-methods                 → { paymentMethod: {...} }   body: { method_type, label, details }
PATCH  /api/payment-methods/:id/default     → { paymentMethod: {...} }
DELETE /api/payment-methods/:id             → { }
```
(No `PATCH .../:id` for editing fields — same UX as most real saved-card flows: remove and
re-add rather than edit in place.)

Response shape per method:
```json
{
  "id": "uuid",
  "methodType": "card",
  "label": "HDFC Bank •••• 4242",
  "details": { "brand": "HDFC Bank", "last4": "4242" },
  "isDefault": true,
  "createdAt": "..."
}
```

**Web implementation** (`gadidosti-client/src/pages/PaymentMethods.jsx`): a list screen + an
add sheet with a 4-way type picker (UPI / Card / Netbanking / Wallet — same categories
`PaymentSheet.jsx`'s checkout already uses, for visual consistency, even though the two aren't
wired together). Per type: UPI asks for a UPI ID (validated as `name@bank` shape client-side
too); Card asks for brand/bank name + last-4-only (the input itself hard-truncates to 4 digits
and strips non-digits, `numeric` inputMode); Netbanking/Wallet are a pick-list of the same
bank/wallet names `PaymentSheet.jsx` already offers.

**Not wired up yet — same flag as above**: `PaymentSheet.jsx`'s checkout doesn't yet offer "pay
with a saved method" — this is a standalone management screen today.

---

## 3. For Flutter (`SSK_Cargo`)

I checked `client_settings_screen.dart` — it currently only has an "Account security" section
(notifications + password). There's no Saved Addresses / Payment Methods entry point, no
existing API client methods for either endpoint, and nothing in the codebase references
`saved_addresses`/`saved_payment_methods` at all. This is a from-scratch build on the Flutter
side, not a small tweak to something half-there.

To mirror the web feature:

1. **API client methods** (`lib/core/network/api_client.dart`) — add the 8 calls above (GET/POST/
   PATCH/DELETE for both resources), same pattern as the app's other list/create/delete methods.
2. **Entry points** — add two rows to `client_settings_screen.dart` (or wherever else the client
   app's own profile/account menu lives), matching the pattern the existing "Notifications" row
   there already uses (`InkWell` → `context.push('/client/...')`).
3. **Saved Addresses screen** — a list + add/edit form. For the Google Places picker, use
   whatever the app's own pickup/drop location search already is (there should be one, since
   booking a truck needs it) rather than building a second one — same idea as the web version
   reusing `PlacesAutocompleteInput`. Add a Name field and a Floor/Unit field alongside it.
4. **Payment Methods screen** — a list + add form with the 4-type picker described above. Keep
   the last-4-digits-only rule for cards — don't build a full card-number input even though
   nothing charges against it yet.

Nothing here needs a new migration or endpoint change on your end — the API is already live and
shaped exactly as documented above.
