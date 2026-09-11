# Live Tracking Sharing, Payment Stages, and Company QR

Feature summary for the team — what shipped, why, and where, across all four repos. For the
Flutter (`SSK_Cargo`) app developer specifically, see the companion doc
`TRACKING_SHARING_PAYMENT_STAGES_QR_FLUTTER_GUIDE.md` in this same folder.

---

## 1. Live tracking sharing

**What it does:** a client (or anyone who can already view a booking — broker, driver, admin)
can generate a shareable link and send it to anyone. The recipient opens it with no login at
all and sees a live-updating tracking view.

**How it works:**
- `POST /api/bookings/:id/track/share-link` (authenticated) mints an unguessable token the
  first time it's called for a booking, and returns the same one on every later call —
  `{ token, shareUrl }`. `shareUrl` is a ready-to-send full URL
  (`https://gadidostclient.asynk.in/t/<token>`).
- `GET /api/track/:token` is fully public — no `Authorization` header, no ownership check.
  Deliberately returns less than the authenticated tracking endpoint: booking number,
  pickup/drop, status, driver name + truck registration (no phone numbers), live location, ETA,
  distance remaining, and an incident banner with no free-text notes.
- `gadidosti-client` has a new "Share Tracking" action on both `BookingDetail.jsx` and
  `TrackShipment.jsx` — it opens the OS share sheet (or falls back to copy-to-clipboard) with
  that link.
- A new public page, `/t/:token` (`PublicTracking.jsx`), renders the tracking view — no sidebar,
  no login prompt, registered outside every authenticated route wrapper in `App.jsx`.
- On a phone, that page first attempts a native-app handoff (`gadidost://track/<token>`, 1.5s
  timeout) before falling back to the web view. **This always falls through today** — `SSK_Cargo`
  has no deep-link/App-Link infrastructure registered yet, and there's no published Play
  Store/App Store listing to redirect to either. The web view is a fully working standalone
  fallback in the meantime; wiring up the real app handoff is mobile-side work, detailed in the
  Flutter guide.

**Data model:** a single new column, `bookings.tracking_share_token` (unique, nullable —
generated lazily on first share, not at booking creation).

---

## 2. Freight payment stages — Advance / To Pay / To Be Billed

**What changed:** the client's payment choice at booking confirmation used to be a binary
Pay Now / Pay Later, with a hardcoded "20% advance required above ₹5,000" rule bolted on. That's
now four clearly labeled stages, using standard freight terminology:

| Stage | Mechanism | Change from before |
|---|---|---|
| **Pay Now** | Full amount, immediately, via Razorpay | Unchanged |
| **Advance** | Partial amount now, rest on delivery | Amount is now tiered and admin-configurable — no longer a flat 20%, and no longer gated behind a ₹5,000 minimum (every tier defines *some* advance now) |
| **To Pay** | Nothing now, full amount collected by the driver (COD) on delivery | Renamed from "Pay Later" — identical mechanism |
| **To Be Billed** | Nothing now, nothing on delivery either — settled out of band later | **New** |

**Advance tiers** (admin-editable in the dashboard's Pricing page, defaults shown):
- Up to ₹5,000 → ₹1,000 flat
- ₹5,001–₹10,000 → ₹2,000 flat
- Above ₹10,000 → 80%

These live in `pricing_config.advanceRule.tiers` (the existing admin-editable JSONB config,
same one that already holds the per-category fare rates) — `PricingModel.computeAdvanceAmount()`
is the single source of truth both the client (via a new `GET /api/bookings/:id/advance-amount`
endpoint) and the payment endpoints themselves read from, so the number shown before paying can
never drift from what's actually charged.

**"To Be Billed"**: a brand-new `payment_status` value. `PATCH /api/bookings/:id/mark-to-be-billed`
records the choice — no gateway involved, since no money moves through the platform for this
path. The driver's delivery-completion Payments step already only activates for
`pending`/`partial` bookings, so a to-be-billed booking is automatically excluded from asking the
driver to collect anything on delivery — no separate change was needed there.

**Where it's built:** `gadidosti-client`'s `RequestDriver.jsx` (which both the direct-driver-pick
and broker-assigned negotiation flows funnel through once a driver is confirmed) now shows all
four as explicit buttons instead of the old two-or-three-depending-on-amount layout.

---

## 3. Company UPI

**What it does:** a driver collecting payment at delivery can show either their own personal UPI
QR (existing) or a platform-wide "Company" UPI QR — their own choice, per collection, via a
toggle on the Payments step. If only one of the two is actually configured, no toggle is
shown — whichever one exists is used directly, same as before this feature existed.

**Where it's configured:** a new "Payments" tab in the admin dashboard's Settings page
(`company_upi_id` / `company_upi_name`, stored on the existing `admin_settings` singleton row
alongside `platform_name`/`contact_email` etc.).

**Where it's used:** `gadidosti-broker-driver`'s `DeliveryCompletionFlow.jsx` — the trip payload
now carries `companyUpiId`/`companyUpiName` right next to the existing `driverUpiId`, and the
same QR-generation mechanism (a plain `upi://pay?...` intent, no gateway) just takes whichever
pair of `{upiId, payeeName}` the driver's toggle currently points at.

---

## Verification

- Backend: `node --check` on every touched file, and a full `require('./src/app.js')` load
  after every change to catch any circular-require or syntax issue immediately.
- `gadidosti-client`, `gadidosti-broker-driver`, `gadidosti-admin-dashboard`: `npm run build`
  passes cleanly on all three.
- Not exercised against a live database or browser session — flag for manual verification:
  generate a real share link and open it in a private/incognito window to confirm no login is
  required; walk one booking through each of the four payment stages; confirm an admin change to
  the advance tiers in the Pricing page is reflected immediately in the client's Advance button
  amount; set a Company UPI in Settings and confirm the driver's toggle appears.
