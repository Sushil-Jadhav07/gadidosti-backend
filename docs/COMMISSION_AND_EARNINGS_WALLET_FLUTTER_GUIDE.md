# Driver/Broker Commission + Earnings Wallet — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Base URL: `https://apigadidosti.asynk.in`. Every response is
`{ success, message, data }` unless noted.

## The idea in one paragraph

This is a **second, separate wallet concept** from the client's prepaid wallet
(`CLIENT_VERIFICATION_WALLET_GEOFENCING_FLUTTER_GUIDE.md`) — it happens to reuse the exact same
`wallets`/`wallet_transactions` tables, but the domain is completely different: this is money the
**platform owes a driver/broker**, not a prepaid balance they spend. When a trip completes, the
driver and the broker (if the booking has one) are each credited their own share automatically —
no action needed from either of them. The only way the balance goes down is when a **superadmin
manually logs a payout** (they paid the person outside the system — bank transfer, UPI, cash —
and recorded it). There is **no recharge flow for this wallet** — don't show a "Recharge" button
on a driver/broker's wallet screen.

## How the credited amount is calculated

Informational only — the app never computes this itself, just displays whatever the API returns.

1. A trip completes → the existing settlement math nets out the client-facing service charge:
   `net_earnings = booking amount − service charge` (unchanged from before this feature).
2. **Commission** — a separate cut, independent of the service charge above — is then taken from
   that `net_earnings`: `credited amount = net_earnings × (1 − commission%)`. Commission is
   whatever the admin set for that specific person (a per-person override), or the platform-wide
   default if they don't have one.

Confirmed worked example from production: a ₹5,500 base fare with a 7% service charge (₹385,
since it's ≤₹10,000) nets ₹5,500 to the settlement; at the default 10% commission, the driver
*and* the broker were each credited `5,500 × 0.9 = ₹4,950` — both off the same trip,
independently of each other.

## Endpoints

### `GET /api/wallet` — role: `driver` or `broker`
```json
{ "balance": 4950.00 }
```

### `GET /api/wallet/transactions?page=1&limit=20` — role: `driver` or `broker`
```json
{
  "transactions": [
    { "id": "…", "type": "earning", "amount": 4950, "balance_after": 4950, "reference_booking_id": "…", "created_at": "…" },
    { "id": "…", "type": "payout",  "amount": 2000, "balance_after": 2950, "note": "Paid via UPI, ref #12345", "created_at": "…" }
  ],
  "total": 2, "page": 1, "limit": 20, "total_pages": 1
}
```
- `type` is `"earning"` (credit, automatic on trip completion) or `"payout"` (debit, logged
  manually by a superadmin) — a driver/broker's wallet never has `"recharge"`/`"booking_payment"`/
  `"refund"` rows; those only ever appear on a client's wallet.
- `note` is a free-text field the admin can attach to a payout (e.g. a payment reference) — only
  ever present on `payout` rows, `null`/absent on `earning` rows.
- **The transaction doesn't carry a commission breakdown** — `amount` on an `earning` row is
  already the post-commission figure. If you want to show "you earned ₹5,500, platform took ₹550"
  as two separate line items, that math isn't available from this endpoint today; ask before
  building a breakdown UI, since it'd need a new field added server-side first.

### Recharge endpoints are still client-only

`POST /wallet/recharge/order` and `POST /wallet/recharge/verify` reject a `driver`/`broker` token
with `403`, by design. Don't show any recharge UI for this role at all — these two endpoints are
not part of this feature.

### Nothing for the app to call for commission rates or payouts

Setting a commission rate (global default or per-person override) and logging a payout are both
**superadmin-only actions on the admin dashboard** — there is no endpoint for the driver/broker
app to read its own commission rate or to initiate/request a payout. The app only ever reads the
two endpoints above.

## What to build in `SSK_Cargo`

1. New **Wallet** screen for both the driver and broker sections of the app (the web app put it
   right next to the existing Earnings screen in the sidebar, under the same "Finance" grouping).
2. Balance card at the top (`GET /api/wallet`), transaction list below it (`GET
   /api/wallet/transactions`) — label `"earning"` rows as something like "Trip Earning" (green/
   credit styling) and `"payout"` rows as "Payout Received" (show the `note` under the row if
   present), same visual pattern as a bank statement.
3. **No recharge button, no amount-entry flow** — this screen is read-only for a driver/broker.
4. Nothing to build for the commission *rate* itself or for logging payouts — both are
   superadmin-only actions on the admin dashboard, not something the driver/broker app surfaces
   or controls.
