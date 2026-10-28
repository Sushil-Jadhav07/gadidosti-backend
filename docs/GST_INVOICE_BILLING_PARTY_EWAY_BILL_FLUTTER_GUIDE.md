# GST Invoice, Billing Party (RCM) & E-Way Bill — Flutter (`SSK_Cargo`) Guide

For the Flutter app developer. Base URL: `https://apigadidosti.asynk.in`. Every response is
`{ success, message, data }` unless noted.

Two changes landed together: a GST-compliant tax invoice (server-side only, nothing to build),
and two new required booking-wizard fields (Who Pays GST, E-Way Bill) that **do** need building.

## Part 1 — GST-compliant invoice (no app changes needed)

`GET /api/bookings/:id/invoice` (unchanged endpoint, still streams a PDF) now produces a proper
GST tax invoice instead of a flat Amount/Platform Fee/Total table:

- **Freight** (the driver/broker's transport charge) is shown with a note that GST on it is
  payable by the recipient under Reverse Charge Mechanism (GadiDost isn't the GTA — the
  driver/broker is — so GadiDost never charges GST on this line).
- **Platform Service Fee** (GadiDost's own commission) is broken into a taxable value + CGST/SGST
  (or IGST) at 18% — a breakdown of the exact fee already charged, not a new amount. **Nothing
  about the booking total (`amount`) changes.**
- Company GSTIN + legal name (admin-configured, verified against Cashfree) print in the header.
- The client's own verified GSTIN (or the billing party's, see Part 2) prints under Bill To.

Nothing here touches any request/response your app already uses — the PDF just looks different
when a client downloads/emails/views it the same way as before.

## Part 2 — Who Pays GST (Step 1, new, required choice)

Every booking now has a payer for GST purposes: the client themselves (**default, unchanged**)
or a named third-party receiver/consignee. Add this to the location step, right before whatever
quick-pick city/area chips you already show.

### The choice

Two-way toggle: **"You Pay"** (`self`) vs **"Receiver Pays"** (`receiver`). Defaults to `self` —
a client who never touches this toggle sees zero behavior change from before.

### If "Receiver Pays" is chosen

Two fields become required: **Supplier Name** (free text) and **GST Number** (15-char GSTIN,
format `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$`, case-insensitive).

**Fetch saved parties first**, so a returning client doesn't retype:
```
GET /api/billing-parties          (role: client)
→ { "parties": [ { "id": "...", "name": "Receiver Co Pvt Ltd", "gstin": "07CMFPS3661A1Z6", "created_at": "..." } ] }
```
Show these as selectable chips (newest first) plus an "Add New" option. Picking a chip fills
both fields from it; "Add New" (or having zero saved parties) shows blank Supplier Name / GST
Number inputs instead. Whatever is submitted — picked or freshly typed — is saved automatically
server-side the moment the booking is created, so it's available in this list on the *next*
booking without any separate "save" action from your app.

### Sending it — `POST /api/bookings` gains three fields

```json
{
  "billed_to": "self",
  "billing_party_name": "Receiver Co Pvt Ltd",
  "billing_party_gstin": "07CMFPS3661A1Z6",
  "eway_bill_number": "123456789012"
}
```
- `billed_to`: `"self"` or `"receiver"`. Omit entirely (or send `"self"`) for the unchanged
  default flow.
- `billing_party_name` / `billing_party_gstin`: **only send these when `billed_to` is
  `"receiver"`** — omit both otherwise.
- `eway_bill_number`: see Part 3 — always required, independent of `billed_to`.

### Validation — new error codes from `POST /api/bookings`

```json
{ "success": false, "message": "Supplier Name and GST Number are required when the receiver is paying", "errors": { "code": "BILLING_PARTY_REQUIRED" } }
```
Returned (`422`) if `billed_to` is `"receiver"` but either field is missing — gate your own
Next-step button the same way (both fields non-empty) so this is a fallback, not the usual path,
same pattern as every other required-field code in this app.

## Part 3 — Mandatory E-Way Bill (Step 2, new, required for every booking)

A single required text field, **unconditional** — not threshold-based, applies to every booking
regardless of `billed_to` or anything else. Add it to the load-details step, e.g. right under
Material Type.

```json
{ "eway_bill_number": "123456789012" }
```
Missing it 422s:
```json
{ "success": false, "message": "E-Way Bill number is required", "errors": { "code": "EWAY_BILL_REQUIRED" } }
```
No specific format is enforced server-side beyond "non-empty" — don't over-validate on your end
either, a plain required text input is enough.

## What's in the booking response now

`GET`/`POST` booking responses (the `booking` object) gained four read-only fields, useful if you
show a booking-detail summary:
```json
{
  "billedTo": "receiver",
  "billingPartyName": "Receiver Co Pvt Ltd",
  "billingPartyGstin": "07CMFPS3661A1Z6",
  "ewayBillNumber": "123456789012"
}
```

## What to build in `SSK_Cargo`

1. **Step 1**: a "You Pay / Receiver Pays" toggle (default `self`). On `receiver`, fetch
   `GET /api/billing-parties` once, show saved parties as chips + "Add New", and require both
   Supplier Name + GST Number (format-check the GSTIN client-side the same way you already do for
   KYC GST verification) before allowing Next.
2. **Step 2**: one new required text field, E-Way Bill No. — block Next until it's non-empty.
3. **Booking submit**: include `billed_to` always, `billing_party_name`/`billing_party_gstin`
   only when `billed_to` is `"receiver"`, and `eway_bill_number` always. Handle
   `BILLING_PARTY_REQUIRED`/`EWAY_BILL_REQUIRED` as a fallback toast (your own pre-submit
   validation should make these rare).
4. **Nothing to build for the invoice itself** — Part 1 is entirely server-side; your existing
   "Download Invoice" call just returns a different-looking PDF.
