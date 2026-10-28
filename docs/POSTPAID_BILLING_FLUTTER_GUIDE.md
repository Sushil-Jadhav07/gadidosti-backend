# Postpaid Billing — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Base URL: `https://apigadidosti.asynk.in`. Every response is
`{ success, message, data }` unless noted.

## The idea in one paragraph

Admin can switch a client from **prepaid** (the default — today's unchanged Pay Now/Advance/
Wallet/To Pay flow, nothing about this guide affects those clients at all) to **postpaid** with a
credit limit. A postpaid client's bookings skip the payment step entirely — no Pay Now/Advance/
Wallet choice is shown, the booking is just created and its amount is added to a running
outstanding balance. That balance is checked against their credit limit on every new booking; once
it's reached, new bookings are blocked (`403`) until the outstanding bill is paid. Separately, a
bill is auto-generated once a month regardless, so a postpaid client who never gets near their
limit still gets billed. **Most apps will never see any of this** — it's entirely conditional on
`billing_type`, fetched fresh per session (see below), never assumed.

## Step 1 — check whether this client is postpaid at all

```
GET /api/bills/account          (role: client)
→ { "billing_type": "prepaid" | "postpaid", "credit_limit": 50000.00 | null, "outstanding": 4200.00 }
```
Call this once per session (don't trust a cached value from login — `billing_type` isn't part of
the login response's user object and can change mid-session, same reasoning as `kyc_status`).
`credit_limit`/`outstanding` are only meaningful when `billing_type` is `"postpaid"`.

- **If `"prepaid"`**: stop here. Nothing else in this guide applies — the booking flow, payment
  screens, and nav are completely unchanged.
- **If `"postpaid"`**: show a "My Bills" nav entry (hidden entirely for prepaid clients) and adjust
  the booking flow per Step 3 below.

## Step 2 — My Bills screen (postpaid clients only)

### `GET /api/bills?page=1&limit=20`
```json
{
  "bills": [
    { "id": "…", "total_amount": 4200, "status": "pending", "trigger": "monthly", "sent_at": "…", "paid_at": null, "created_at": "…" },
    { "id": "…", "total_amount": 5800, "status": "paid", "trigger": "credit_limit", "sent_at": "…", "paid_at": "…", "created_at": "…" }
  ],
  "total": 2, "page": 1, "limit": 20, "total_pages": 1
}
```
- `status` is `"pending"` or `"paid"`.
- `trigger` is `"monthly"` (the regular 1st-of-the-month sweep) or `"credit_limit"` (raised early
  because the client hit their limit) — purely informational, doesn't change how you'd display or
  pay it.
- `sent_at` — when admin explicitly sent this bill (nullable; a bill can exist before it's sent,
  though you'll also get a push notification the moment it is).

### `GET /api/bills/:billId` — one bill's line items
```json
{
  "bill": { "id": "…", "total_amount": 4200, "status": "pending", … },
  "items": [
    { "id": "…", "booking_id": "…", "booking_number": "BKG-202601-004", "amount": 2200, "pickup_location": "…", "drop_location": "…", "booking_date": "…" },
    { "id": "…", "booking_id": "…", "booking_number": "BKG-202601-007", "amount": 2000, "pickup_location": "…", "drop_location": "…", "booking_date": "…" }
  ]
}
```
Use this for a bill-detail screen showing exactly which bookings make up the total.

### Paying a bill — same Razorpay pattern as everything else

```
POST /api/bills/:billId/payment/order     → { "order": { orderId, amount, currency, status, keyId, provider } }
POST /api/bills/:billId/payment/verify    body: { order_id, razorpay_payment_id, razorpay_signature } → { "bill": {...} }
```
Identical shape/flow to `RAZORPAY_FLUTTER_INTEGRATION_GUIDE.md`'s booking-payment steps 1–3 —
open the real Razorpay SDK with the order's `keyId`/`orderId`, then verify server-side. `amount`
on the order is the bill's full `total_amount`; there's no partial-payment option in-app (admin
can still log a partial... actually no — a bill is paid in full or not at all, same as any other
single payment). Once verified, the bill flips to `"paid"` and every booking in it is marked paid.

## Step 3 — the booking flow, for a postpaid client

This is the one real behavior change. When `billing_type === "postpaid"`:

1. **Don't show the payment-method step at all** — no Pay Now / Pay Advance / Pay from Wallet / To
   Pay / To Be Billed buttons. `POST /api/bookings` is called exactly like it is today (same
   fields), and the backend automatically marks it `payment_status: "to_be_billed"` — nothing to
   send or choose.
2. **Handle the new `CREDIT_LIMIT_REACHED` error**:
   ```json
   {
     "success": false,
     "message": "You've reached your credit limit of ₹50,000. Please clear your outstanding bill before booking again.",
     "errors": { "code": "CREDIT_LIMIT_REACHED" }
   }
   ```
   Returned as a `403` from `POST /api/bookings` the moment `outstanding >= credit_limit`. Show
   `message` as-is (it already states the limit) — a plain toast/snackbar is enough, same as the
   geofencing error codes in the other guide; there's no "go verify" redirect needed here, just
   point them at My Bills to pay down what they owe.
3. Everything else about booking (location, load details, truck selection, search mode) is
   completely unchanged — this only affects the final payment step.

## What to build in `SSK_Cargo`

1. Fetch `GET /api/bills/account` once per session (alongside the existing KYC-status and wallet
   fetches, same pattern) and store `billing_type`/`credit_limit`/`outstanding`.
2. Conditionally show a **My Bills** nav entry — only when `billing_type === "postpaid"`.
3. New **My Bills** screen: outstanding-balance card (with credit limit shown alongside it), bill
   list (status badge, amount, date), tap-through to a detail screen with line items, "Pay Now"
   on a pending bill opening the same Razorpay flow used elsewhere in the app.
4. In the booking-confirm flow: check `billing_type` before rendering the payment-method step —
   skip straight to creating the booking for a postpaid client, handle `CREDIT_LIMIT_REACHED` as
   described above. **Everything else in the booking wizard is untouched.**
5. Nothing to build for setting the billing type or credit limit itself, generating bills, or
   sending them — all three are superadmin-only actions on the admin dashboard.
