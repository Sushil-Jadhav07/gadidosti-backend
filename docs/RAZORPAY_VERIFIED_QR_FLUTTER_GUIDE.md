# Razorpay Verified Payment QR — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. New backend capability, checked against the actual `SSK_Cargo`
driver payment screen — every citation below is real.

## Read this first if you haven't already

`TRACKING_SHARING_PAYMENT_STAGES_QR_FLUTTER_GUIDE.md` (§3, "Company QR") already documents a
prerequisite gap: `SSK_Cargo`'s driver payment screen
(`lib/features/driver/presentation_screens/driver_payment_screen.dart` — see `_uploadQrCode()`,
lines 205–261) still uses the **old** approach of the driver manually photographing/uploading a
static QR image (`uploadDriverPaymentQr`), instead of generating a fresh amount-embedded
`upi://pay?...` QR client-side the way the web driver app now does. This guide is the next
layer on top of that fix, not a replacement for it — read that section first.

## What's new: a third, verified QR option

Both the static-upload QR and the amount-embedded UPI-intent QR (once built per the guide above)
share the same limitation: they're direct peer-to-peer bank transfers Razorpay never sees, so
there's nothing to independently confirm the customer actually paid — the driver just self-reports
"payment received". The backend now also supports a **Razorpay-verified** QR: created via
Razorpay's own QR Code API, tied to the exact amount due, and confirmed by Razorpay itself — no
self-report needed.

Reference implementation: `gadidosti-broker-driver`'s `DeliveryCompletionFlow.jsx`
(`PaymentsStep` function) — it now offers a 3-way toggle (Personal / Company / **Verified QR**)
when more than one source is available, and only shows the "Verified QR" tab at all when
`trip.razorpayQrAvailable` is true.

## New fields on the trip object

Whatever endpoint you already use for the active trip (`GET /api/trips/:id` /
`GET /api/trips/active`) now also returns:

| Field | Type | Notes |
|---|---|---|
| `razorpayQrAvailable` | boolean | Only show the Verified QR option at all when true — false whenever the backend's active gateway isn't Razorpay. |
| `razorpayQrCodeId` | string \| null | Set if a QR was already generated on a previous visit to this screen (e.g. app was backgrounded and reopened). |
| `razorpayQrImageUrl` | string \| null | A ready-to-use image URL hosted on Razorpay's own CDN — if already set, you can skip straight to displaying it instead of calling create again. |
| `razorpayQrStatus` | `'active'` \| `'closed'` \| null | Only reuse an existing `qrCodeId`/`imageUrl` if this is `'active'`. |

## The two endpoints

### 1. Create (or reuse) the QR

```
POST /api/trips/:id/collect-payment/qr      (driver or broker on the trip)
→ 200 { qrCodeId, imageUrl }
```
`imageUrl` is a real image — just load it directly (`Image.network(imageUrl)`), no local QR
rendering package needed for this path (unlike the UPI-intent QR, which you do have to render
yourself client-side). Safe to call even if a QR already exists for this trip — the backend
returns the still-open one rather than creating a duplicate.

Errors: `409` if the trip's booking is already paid, or if `PAYMENT_PROVIDER` isn't `razorpay`
server-side (shouldn't happen if you're gating on `razorpayQrAvailable`, but handle it anyway).

### 2. Poll for confirmation

```
GET /api/trips/:id/collect-payment/qr/status
→ 200 { paid: boolean }
```
Poll this every ~3–4 seconds while the Verified QR tab is showing and `paid` is still false.
**The moment `paid: true` comes back, the backend has already fully finalized the payment
server-side** — booking marked paid, notifications sent, everything the existing
`PATCH /api/trips/:id/collect-payment` call normally does. Do **not** also call
`collect-payment` afterward — just update your local trip state (`paymentStatus: 'paid'`) and
advance to whatever your completion/thank-you screen is, the same way a successful
`collectTripPayment` call already does at `driver_payment_screen.dart` lines 283–302.

Stop polling (clear the timer) the moment `paid` is true, when the driver navigates away from
this screen, or when they switch to a different QR tab — same lifecycle discipline the web
version's polling `useEffect` cleanup follows.

## What to build

1. Only render the "Verified QR" option when `trip.razorpayQrAvailable` is true. If it's the
   only available source (no personal/company UPI configured), skip the tab UI entirely and just
   show this QR directly — mirror however the web version's `availableSources`/tab-visibility
   logic decides that.
2. On selecting this tab (or on load, if it's the only option): if `razorpayQrImageUrl` is
   already set and `razorpayQrStatus == 'active'`, use it directly; otherwise call the create
   endpoint once.
3. Show the image, a "waiting for payment" indicator, and start polling.
4. On `paid: true`: stop polling, update local state, auto-advance — no button tap required for
   this path specifically. The existing "Payment Received via UPI" self-report button (whatever
   drives today's `_collectPayment('upi')` call) doesn't make sense while this tab is showing an
   *unpaid* Razorpay QR — hide or disable it in that state, same as the web version does, since
   tapping it would just self-report something the poll is about to confirm for real anyway. Keep
   the cash-collection option available regardless — it's a genuinely separate outcome (the
   customer decided to pay cash instead), not something this QR flow supersedes.
5. Handle QR-creation failure with a clear inline error and let the driver fall back to another
   tab (Personal/Company UPI) or cash — same as the existing `qrError` pattern that guide §3
   describes for the client-generated QR.
