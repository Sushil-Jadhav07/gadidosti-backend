# Bilty (Lorry Receipt) — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Base URL: `https://apigadidosti.asynk.in`. Every response is
`{ success, message, data }` unless noted.

## The idea in one paragraph

A Bilty (Lorry Receipt / Goods Consignment Note) is a **second, separate document** from the GST
tax invoice already covered in `GST_INVOICE_BILLING_PARTY_EWAY_BILL_FLUTTER_GUIDE.md`. It's the
transporter's own goods-receipt — proof of what was handed over, by whom, to whom, and on which
truck — not a tax document, so it carries no GST/CGST/SGST breakdown at all. The backend already
**auto-emails it to the client the moment a trip is marked Delivered** — nothing to build for
that part. What you do need to build: a way for the client to download their own copy or have it
re-sent, same as the existing invoice buttons.

## Availability — same gate as the invoice

A booking's Bilty becomes available at the same point the invoice does — once its status is
`Delivered` or `Completed`. Reuse whatever check you already have for showing the invoice
buttons (`INVOICE_READY_STATUSES` in the web app, if you're porting that logic).

## Download — `GET /api/bookings/:id/bilty`

Streams a PDF, same pattern as `GET /api/bookings/:id/invoice`:

```
GET /api/bookings/:id/bilty
Authorization: Bearer <token>
→ Content-Type: application/pdf
→ Content-Disposition: attachment; filename="bilty-<booking_number>.pdf"
```

Accessible to the client, broker, or driver on that booking, or an admin — same ownership rule
as every other booking-scoped document endpoint. The server assigns the Bilty a human-readable
reference number (`LR-YYYYMM-NNN`) the first time it's generated for that booking and reuses it
on every later call — you don't need to request or track this number yourself, it's embedded in
the PDF.

## Resend — `POST /api/bookings/:id/bilty/send`

```
POST /api/bookings/:id/bilty/send
Authorization: Bearer <token>
Body: {}   (nothing to send — see below)
→ { "biltyNumber": "LR-202610-001" }
```

Unlike the invoice's email endpoint (which lets you compose a `to`/`subject`/`message` and send
to anyone), this one **always emails the client's own address on file** — there's no compose
step. It's meant as a plain "Resend" action: the client taps it to get another copy in their
inbox, or a broker/driver resends it if the automatic on-delivery send didn't land for some
reason.

- `422` if the client has no email on file: `{ "message": "This client has no email on file to send the Bilty to" }`
- `502` if the email provider itself failed to send

## What to build in `SSK_Cargo`

1. On the booking detail screen, once the booking is Delivered/Completed, add two buttons next
   to the existing invoice ones:
   - **Download Bilty** — `GET /api/bookings/:id/bilty`, save/open the PDF, same as how you
     already handle the invoice download.
   - **Resend Bilty** — `POST /api/bookings/:id/bilty/send`, no body, show a toast/snackbar on
     success (`"Bilty emailed to you"`) or the error message on failure.
2. Nothing to build for the automatic send itself — it already happens server-side the instant a
   driver marks a trip Delivered, with no app involvement.
3. No new booking-creation fields — the Bilty reuses whatever was already sent at booking time
   (consignor/consignee from `billed_to`/`billing_party_name`/`billing_party_gstin`, covered in
   the GST/billing-party guide). You don't need to collect or send anything new for this feature.
