# Razorpay Gateway Never Actually Opens in `SSK_Cargo` — Flutter Guide

For the Flutter app developer. This is a root-caused bug report, not a hypothesis — every claim
below was confirmed by reading the actual `SSK_Cargo` and `gadidosti-backend` source, cited with
file + line.

## The bug, in one sentence

`SSK_Cargo`'s client-side payment screen never calls the real Razorpay gateway at all — it calls
a legacy "mark myself as paid, no gateway involved" endpoint that the backend now **hard-blocks**
the moment `PAYMENT_PROVIDER=razorpay` is turned on (which it now is), so every payment attempt
from the app just gets a `409` error back instead of ever opening a checkout screen.

## Root cause, traced end to end

1. **The "hardcoded payment screen"**: `lib/features/client/presentation/widgets/client_flow_widgets.dart`
   has a `PaymentMethod` enum (`googlePay`, `phonePe`, `paytm`, `otherUpi`, `card`,
   `cashOnDelivery`, `netBanking`, `emi`, `payLater` — lines 736–759) and a method-picker card
   (`_PaymentMethodsCard`, built at line 4471) that the booking flow's Payment step renders
   (`_buildPaymentStep`, line 4470). Selecting a method is purely cosmetic — it just sets
   `_selectedPaymentMethod` in local state (line 4474). Nothing about the choice is ever sent
   anywhere.
2. Confirming the booking with a method selected calls `_submitBooking()` (line 3252), which
   `POST`s the booking with `'payment_status': 'pending'` **hardcoded into the payload** (line
   3425) — the booking is created unpaid regardless of what was picked above.
3. Paying for an existing booking calls `_payExistingBooking()` (line 3310), which calls
   `apiClientProvider.payBooking(...)`.
4. `payBooking()` in `lib/core/network/api_client.dart` (lines 299–310) sends
   **`PATCH /api/bookings/:id/pay`** — that's the whole payment integration. There is no other
   payment-related network call anywhere in the app: confirmed zero matches for
   `payment/order`, `payment/verify`, `razorpay_flutter`, `orderId`, or `keyId` anywhere under
   `lib/`. `pubspec.yaml` doesn't even depend on `razorpay_flutter` (or any Razorpay package) —
   only `dio` (line 38) for plain HTTP.
5. On the backend, `PATCH /api/bookings/:id/pay` is `payBooking` in
   `gadidosti-backend/src/controllers/booking.controller.js` (lines 573–604). Read its own
   comment (lines 574–582): it's a **client-marks-self-as-paid bypass with no gateway
   involved at all** — harmless back when every "payment" was simulated, but a free "pay
   nothing, mark it paid" exploit the moment real money is on the line. So the very first thing
   it does now (line 585–587):
   ```js
   if (process.env.PAYMENT_PROVIDER === 'razorpay') {
     return errorResponse(res, 409, 'Online payments must go through the payment gateway — use /payment/order and /payment/verify instead.');
   }
   ```
   `PAYMENT_PROVIDER=razorpay` is exactly what's configured in this deployment (confirmed in
   `gadidosti-backend/.env`) — so **every single call `SSK_Cargo` makes to pay a booking now
   returns this 409**, with no gateway ever attempted. This is the entire "Razorpay isn't
   opening" symptom — nothing in the app ever tries to open it in the first place.

The web client (`gadidosti-client`) hit this exact same wall previously and was already fixed —
its `PaymentSheet.jsx` component (`src/components/PaymentSheet.jsx`) is the reference
implementation for what `SSK_Cargo` needs to do instead. Read it for the full flow; the essentials:

## The two endpoints to actually use (already correct on the backend — nothing to fix there)

### 1. Create a gateway order

```
POST /api/bookings/:id/payment/order      (authenticated, client role)
Body: { "pay_type": "full" | "advance" }
→ 200 { order: { orderId, amount, currency, status, keyId, provider: "razorpay" | "fake" }, pay_type }
```
- `provider` tells you which branch to take. In this deployment it will be `"razorpay"`, but keep
  the `"fake"` branch too (see `FakePaymentProvider` — `gadidosti-backend/src/providers/payment/FakePaymentProvider.js`) so the app doesn't break in a dev/staging environment where the
  gateway isn't configured. `PaymentSheet.jsx` handles both (see its `gateway` state).
- `keyId` is Razorpay's public key — pass it straight to the SDK, never hardcode a key in the app.
- `amount` here is in rupees (not paise) — the backend's own `RazorpayPaymentProvider.createOrder`
  (`gadidosti-backend/src/providers/payment/RazorpayPaymentProvider.js`, line 22) is the one that
  multiplies by 100 for Razorpay's order API; don't double-convert.

### 2. Open the real gateway (this is the missing piece — needs a new dependency)

Add `razorpay_flutter` to `pubspec.yaml`. Create the checkout with the fields from the order
above:
```dart
final razorpay = Razorpay();
razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, _handlePaymentSuccess);
razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, _handlePaymentError);
razorpay.open({
  'key': order['keyId'],
  'amount': (order['amount'] as num) * 100,   // paise, same conversion PaymentSheet.jsx does client-side too
  'currency': order['currency'] ?? 'INR',
  'order_id': order['orderId'],
  'name': 'GadiDost Logistics',
  'prefill': {'contact': userPhone},
});
```
`EVENT_PAYMENT_SUCCESS`'s response carries `paymentId` and `signature` — that's what step 3 needs.

### 3. Verify server-side (this is what actually marks the booking paid — never trust the SDK's own "success" alone)

```
POST /api/bookings/:id/payment/verify     (authenticated, client role)
Body: {
  "order_id": "<orderId from step 1>",
  "pay_type": "full" | "advance",
  "payment_mode": "razorpay",
  "razorpay_payment_id": "<from EVENT_PAYMENT_SUCCESS>",
  "razorpay_signature": "<from EVENT_PAYMENT_SUCCESS>"
}
→ 200 { booking: {...} }        // only now is payment_status actually updated
→ 402 if the signature doesn't check out
```
This is `verifyBookingPayment` in `booking.controller.js` (lines 631–655) — it HMAC-verifies the
signature server-side (`RazorpayPaymentProvider.verifyPayment`) before calling `finalizePayment`.
Nothing is marked paid without this call succeeding.

## What to remove / change in `SSK_Cargo`

- Stop calling `payBooking()` / `PATCH /api/bookings/:id/pay` for online payment — it's dead now
  for this deployment (always 409s) and was never meant to survive past the demo phase (see the
  backend comment cited above). Keep `PaymentMethod.cashOnDelivery` / `PaymentMethod.payLater` as
  they are if those genuinely skip online payment entirely (worth confirming they don't also
  route through `payBooking`).
- The `PaymentMethod` picker itself (googlePay/phonePe/paytm/card/netBanking/emi) doesn't need to
  be deleted — Razorpay's own checkout UI already offers all of these as payment options once
  opened; you likely just need "Pay Now" to open the real gateway (steps 1–3 above) instead of
  calling `payBooking()`, rather than trying to preselect a specific method for Razorpay's widget.
- Wire `_submitBooking()` (or wherever the "Continue"/"Pay" action for a fresh booking lives) and
  `_payExistingBooking()` to go through create-order → open Razorpay → verify, instead of the
  current single `payBooking()` call.
