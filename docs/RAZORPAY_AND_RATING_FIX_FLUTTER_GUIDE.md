# Razorpay Integration & the Rating 404 — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Two unrelated backend changes just shipped — one needs real
Flutter work, the other needs none at all. Both checked against the actual `SSK_Cargo` source,
not assumed.

---

## 1. The rating 404 — already fixed, zero Flutter changes needed

**Good news first.** `POST /api/bookings/:id/rate` was returning 404 — the route simply didn't
exist on the backend, even though `bookings.rating` (the column) and `projectBooking`'s
`rating: row.rating || null` field were already there. It's been added now.

Checked `SSK_Cargo`'s own code for this: **it was already built correctly** —
`api_client.dart`'s `rateBooking()` (line 312-329) already sends exactly
`{ stars, review }`, and `tracking_details_screen.dart`'s `_rateBooking()` (line 527+) already
has a full star-rating dialog wired to it. The 404 was the only thing wrong. Nothing here needs
touching — the same dialog that was failing before will just work now, no rebuild-and-redesign
needed, only a backend redeploy.

---

## 2. Razorpay — real work needed here

### What changed on the backend

- `POST /api/bookings/:id/payment/order` (NEW) — opens a real Razorpay order (or a mock one in
  demo/dev mode) for a given `pay_type` (`'full'` or `'advance'`).
- `POST /api/bookings/:id/payment/verify` (NEW) — verifies the gateway's signature server-side,
  then records the payment. This is the only thing that ever actually marks a booking paid now.
- `PATCH /api/bookings/:id/pay` (the endpoint `SSK_Cargo` currently uses) — **now blocked in
  production**. Once the backend's `PAYMENT_PROVIDER` is set to `razorpay` (which it now is),
  this endpoint returns `409 "Online payments must go through the payment gateway — use
  /payment/order and /payment/verify instead."` for every call, unconditionally.

**Why it's blocked, not just deprecated:** this endpoint never actually checked whether a
payment happened — it just marked the booking paid on request. That was fine when every
"payment" in the system was a simulated demo checkout. It stops being fine the moment real money
is involved: without the block, anyone could call it directly and get a booking marked "paid"
for free, no money ever changing hands. So it had to be locked down as part of turning real
payments on, not left as a quieter "please migrate off this eventually."

### What this means for `SSK_Cargo` right now

Checked both call sites — **`SSK_Cargo`'s entire payment flow today is these two bare calls,
with no actual checkout UI in front of them at all**:
- `client_flow_widgets.dart` line 3310-3320 (`_payExistingBooking`)
- `client_flow_widgets.dart` line ~5085-5100 (the direct-negotiation payment confirm)

Both just call `payBooking(accessToken, id)` — no card form, no UPI, no amount confirmation
screen, nothing. Tapping "Pay" apparently just marked the booking paid immediately. **Both of
these will now return a 409 and fail** — there's no fallback behavior to preserve; a real
checkout flow needs to be built here for the first time, mirroring what `gadidosti-client` (the
web app) now has.

### What to build

1. **Add the Razorpay Flutter SDK** — `razorpay_flutter` on pub.dev is the official package
   (not currently in `pubspec.yaml` — confirmed). It opens Razorpay's own native checkout sheet,
   the same widget web's Razorpay Checkout.js shows, just as a Flutter plugin.

2. **Add two `api_client.dart` methods**, next to the existing `payBooking`:
   ```dart
   Future<Map<String, dynamic>> createPaymentOrder({
     required String accessToken,
     required String bookingId,
     String payType = 'full',
   }) async {
     return _request(
       () => _dio.post<Map<String, dynamic>>(
         '/api/bookings/$bookingId/payment/order',
         data: {'pay_type': payType},
         options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
       ),
     );
   }

   Future<Map<String, dynamic>> verifyPayment({
     required String accessToken,
     required String bookingId,
     required String orderId,
     required String payType,
     required String paymentMode,
     Map<String, dynamic>? gatewayPayload,
   }) async {
     return _request(
       () => _dio.post<Map<String, dynamic>>(
         '/api/bookings/$bookingId/payment/verify',
         data: {
           'order_id': orderId,
           'pay_type': payType,
           'payment_mode': paymentMode,
           ...?gatewayPayload,
         },
         options: Options(headers: {'Authorization': 'Bearer $accessToken'}),
       ),
     );
   }
   ```

3. **Wire the flow** at both `_payExistingBooking` call sites:
   ```dart
   final orderRes = await api.createPaymentOrder(accessToken: token, bookingId: id);
   final order = orderRes['data']['order'];

   final razorpay = Razorpay();
   razorpay.on(Razorpay.EVENT_PAYMENT_SUCCESS, (PaymentSuccessResponse r) async {
     await api.verifyPayment(
       accessToken: token,
       bookingId: id,
       orderId: order['orderId'],
       payType: 'full',
       paymentMode: 'razorpay',
       gatewayPayload: {
         'razorpay_payment_id': r.paymentId,
         'razorpay_signature': r.signature,
       },
     );
     // proceed to the confirmed/success state, same as today
   });
   razorpay.on(Razorpay.EVENT_PAYMENT_ERROR, (PaymentFailureResponse r) {
     // show r.message
   });

   razorpay.open({
     'key': order['keyId'],
     'amount': (order['amount'] * 100).round(), // paise
     'currency': order['currency'] ?? 'INR',
     'order_id': order['orderId'],
     'name': 'GadiDost Logistics',
   });
   ```
   `order.provider` in the order response is `'razorpay'` in production or `'fake'` in
   dev/demo mode (`PAYMENT_PROVIDER` on the backend) — check it before deciding whether to open
   the real Razorpay sheet or just call `verifyPayment` directly with no gateway payload (the
   fake provider's `verifyPayment` always succeeds regardless of payload, same as the web app's
   own fake-mode fallback).

### Full API reference

**POST `/api/bookings/:id/payment/order`** `{ pay_type: 'full' | 'advance' }`
→ `{ success, data: { order: { orderId, amount, currency, status, keyId, provider }, pay_type } }`
`amount` is in rupees (not paise — multiply by 100 yourself when calling `razorpay.open`).
`keyId` is only meaningful when `provider === 'razorpay'`.

**POST `/api/bookings/:id/payment/verify`** `{ order_id, pay_type, payment_mode, razorpay_payment_id?, razorpay_signature? }`
→ `{ success, data: { booking: <full re-projected booking> } }` on success, `402` if the
signature doesn't check out.

**PATCH `/api/bookings/:id/pay`** — still exists, but now `409`s whenever the backend's
`PAYMENT_PROVIDER` is `razorpay`. Don't build anything new against it.
