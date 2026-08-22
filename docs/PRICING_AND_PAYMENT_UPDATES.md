# Pricing & Payment Updates — Surge Pricing, 20% Advance, Remaining-Balance Display

Three backend/web changes just shipped. This doc is what the Flutter app (`SSK_Cargo`) needs to
handle for each — I read through the actual Flutter source (not guessing) to figure out exactly
what's already fine as-is versus what genuinely needs a code change.

---

## 1. Nearby-truck surge pricing (+5% when >5 trucks are near pickup)

**What changed server-side**: `PricingModel.estimate()` (`gadidosti-backend/src/models/pricing.model.js`)
now looks up how many available trucks are within 10km of the pickup point. If there are more
than 5, the fare gets a flat **+5%** surge (`supplyMultiplier`), applied the same way the
existing traffic-surge multiplier already was. This only fires when the caller sends
`pickup_lat`/`pickup_lng` — omit them and pricing behaves exactly as before (no surge).

Both `POST /api/bookings/quote` (the live preview) and `POST /api/bookings` (actual booking
creation) now accept and use `pickup_lat`/`pickup_lng` for this.

**What Flutter needs to change — one real gap found**:

`SSK_Cargo/lib/features/client/presentation/widgets/client_flow_widgets.dart`'s
`_estimateBookingAmount()` (~line 3224) builds the quote payload without pickup coordinates:

```dart
final payload = <String, dynamic>{
  'distance': distance,
  'truck_category': _truckCategoryForVehicle(_vehicle.label),
  'transport_type': _draft.transportType,
  'truck_type': _vehicle.label,
};
```

`_draft.pickupLat`/`_draft.pickupLng` are already populated by this point (set earlier when the
pickup location is resolved, ~line 3202) — they're just not included here. Add them:

```dart
final payload = <String, dynamic>{
  'distance': distance,
  'truck_category': _truckCategoryForVehicle(_vehicle.label),
  'transport_type': _draft.transportType,
  'truck_type': _vehicle.label,
  if (_draft.pickupLat != null) 'pickup_lat': _draft.pickupLat,
  if (_draft.pickupLng != null) 'pickup_lng': _draft.pickupLng,
};
```

**Why this matters**: `createBooking()`'s payload (~line 3403, `_submitBooking`) **already**
sends `'pickup_lat': _draft.pickupLat ?? 0`, so the actual booking that gets created already
gets the correct surge-adjusted price server-side. Without the fix above, the *live estimate the
client sees before confirming* just won't reflect the surge — so a client could see one number
on the estimate screen and then have the real booking come out ~5% higher when there happen to
be >5 trucks nearby. Same class of bug the web client (`BookTruck.jsx`) had before this pass —
already fixed there.

Nothing else needs to change for this part — no new UI, no new field to display, just the two
extra keys in that one payload.

---

## 2. 20% advance required for bookings over ₹5,000 (Pay Later still fine for ₹5,000 and under)

**What changed server-side**:

- `PATCH /api/bookings/:id/pay` now takes an optional `pay_type` field: `'full'` (default,
  unchanged behavior) or `'advance'`.
  - `pay_type: 'advance'` is **rejected with 422** if the booking's amount is ≤ ₹5,000 — this is
    enforced server-side, not just a UI suggestion, so don't rely on the app alone to gate it.
  - On success, `'advance'` sets the booking's `payment_status` to a new value, **`'partial'`**
    (sits between `'pending'` and `'paid'`), and records `amount_paid` = 20% of the total.
    `'full'` behaves exactly as before (`payment_status: 'paid'`, `amount_paid` = full amount).
- `bookings.amount` is unchanged; the new `bookings.amount_paid` column is what tracks progress.

**Where this shows up in the booking flow**: right after a driver/broker confirms a negotiated
price — same moment the web app's Pay Now / Pay Later buttons appear. For a booking over ₹5,000,
**Pay Later should no longer be offered at all** — replace it with a "Pay 20% Advance" option.
Pay Now (full amount) stays available regardless of the amount.

```dart
// Mirrors ADVANCE_PAYMENT_THRESHOLD / ADVANCE_PAYMENT_PCT in gadidosti-backend's
// booking.controller.js and gadidosti-client's RequestDriver.jsx — keep this in sync manually,
// there's no shared config endpoint for it yet.
const advancePaymentThreshold = 5000.0;
const advancePaymentPct = 0.2;

final requiresAdvance = finalAmount > advancePaymentThreshold;
final advanceAmount = (finalAmount * advancePaymentPct * 100).round() / 100;
```

**`ApiClient.payBooking()` needs a `payType` param** (`SSK_Cargo/lib/core/network/api_client.dart:299`)
— right now it sends no body at all:

```dart
Future<Map<String, dynamic>> payBooking({
  required String accessToken,
  required String id,
  String payType = 'full', // 'full' | 'advance'
}) async {
  return _request(
    () => _dio.patch<Map<String, dynamic>>(
      '/api/bookings/$id/pay',
      data: {'pay_type': payType},
      options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
    ),
  );
}
```

(Omitting `pay_type` entirely still works fine — the backend defaults to `'full'` — but passing
it explicitly is clearer and is what lets you add the advance path.)

**Please double-check this while you're in the file** — not something I changed, just something
I noticed reading the code that directly affects this: `_payExistingBooking()`
(`client_flow_widgets.dart:3310`), which is what actually runs when the client taps Continue on
the post-negotiation payment step, calls `payBooking()` **unconditionally**, regardless of which
`PaymentMethod` is selected — including `PaymentMethod.payLater`. On the web app, choosing Pay
Later never calls the pay endpoint at all (the booking just stays `payment_status: 'pending'`
until someone pays later). If Flutter's `payLater` selection is currently also triggering a real
`payBooking()` call, that would mark bookings as paid even when the client picked "pay later" —
worth confirming and, if so, skipping the API call entirely for that selection (same as web),
rather than only fixing this for the new advance case.

---

## 3. Driver app: "amount to collect" now shows the true remaining balance

**What changed server-side**: `GET /api/trips/:id` (and everywhere else a trip is projected)
now returns `amountToCollect` as `booking.amount - booking.amount_paid` — previously it was
always the full booking amount, which would have been wrong for any booking that already had a
20% advance paid online. `paymentStatus` on the trip can now also be `'partial'`, not just
`'pending'`/`'paid'`.

**Good news — I checked, and most of this already works correctly with zero Flutter changes:**

- `driver_payment_screen.dart` (~line 74) reads `trip['amountToCollect']` straight from the API
  and displays it as "Collect from customer" — it'll automatically show the correct remaining
  balance the moment the backend is deployed. No change needed.
- `driver_delivery_photo_upload_screen.dart` (~lines 87 and 176) already routes to the payment
  screen for **anything that isn't exactly `'paid'`** (`if (paymentStatus == 'paid') { ... } else
  { go to payment }`), so a `'partial'` trip already correctly lands on the payment step instead
  of being skipped. This is actually more robust than the web driver app was before this pass —
  the web app explicitly checked `=== 'pending'` in four places and had to be widened to include
  `'partial'` too; Flutter's `else`-based check already covers it for free.

**One optional cosmetic improvement, not required**: `driver_payment_screen.dart:459` shows
`_paymentStatus == 'paid' ? 'Paid' : 'Payment pending'` — for a `'partial'` trip this says
"Payment pending," which is technically true (something's still owed) but doesn't tell the
driver an advance was already collected online. If you want to match the web driver app's
wording, something like:

```dart
Text(
  _paymentStatus == 'paid'
      ? 'Paid'
      : _paymentStatus == 'partial'
          ? 'Advance paid — balance due'
          : 'Payment pending',
  ...
)
```

---

## Quick checklist

| Item | File | Required? |
|---|---|---|
| Add `pickup_lat`/`pickup_lng` to the quote payload | `client_flow_widgets.dart` `_estimateBookingAmount()` | Yes — fixes preview-vs-actual price mismatch |
| Add `payType` param to `payBooking()` | `api_client.dart:299` | Yes — needed for the advance flow |
| Add advance-payment threshold logic + "Pay 20% Advance" option | `client_flow_widgets.dart` payment step UI | Yes |
| Verify `_payExistingBooking()` skips the API call for `payLater` | `client_flow_widgets.dart:3310` | Please confirm — flagged above, may already be a pre-existing bug unrelated to this change |
| `amountToCollect` display | `driver_payment_screen.dart` | No — already correct |
| Payment-step routing for `'partial'` trips | `driver_delivery_photo_upload_screen.dart` | No — already correct |
| "Payment pending" → "Advance paid — balance due" wording for `'partial'` | `driver_payment_screen.dart:459` | Optional |
