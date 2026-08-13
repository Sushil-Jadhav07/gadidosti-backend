# SSK Logistics / GadiDost — UI Redesign Prompt Pack (Google Stitch)

A ready-to-paste set of prompts for redesigning the three web dashboards, built from the actual
page inventory of this platform (not generic guesses). Structure:

1. Paste the **Design System** prompt first, in its own Stitch project/thread, to lock in one
   consistent visual language across all three apps (right now each app has its own slightly
   drifted flavor of the same brand — this is the fix for that).
2. Then run each **per-screen prompt** below inside that same thread/style so Stitch keeps
   reusing the established system instead of drifting per screen.
3. Screens within the same app are grouped so you can batch them in one Stitch session.

Each prompt is written the way Stitch responds best to — a short paragraph of context, then an
explicit list of the components that must be on the screen (Stitch tends to drop things that
aren't spelled out).

---

## 0. Design System (paste this first, every time)

> Design a cohesive UI system for **SSK Logistics (GadiDost)**, a trucking/logistics marketplace
> connecting clients (people booking truck shipments), brokers (fleet owners who negotiate and
> assign drivers), drivers, and platform admins. Three separate web apps share this one system: a
> consumer-facing client app, a mobile-first driver/broker operations app, and a desktop admin
> dashboard.
>
> **Visual direction**: modern logistics SaaS — think Uber Freight, Porter, or a clean Stripe-style
> dashboard, not a heavy enterprise ERP. Confident but calm; data-dense screens should still feel
> breathable, not cramped.
>
> - **Primary color**: a strong confident blue (#1976FF), with a deep navy accent (#0D3B85) for
>   gradients/headers on the consumer-facing app.
> - **Semantic colors**: green for success/available/paid, amber for warning/pending, red for
>   danger/cancelled — used sparingly, only on status badges and alerts, never as large fills.
> - **Typography**: Poppins (semibold/bold) for headings and numbers, a clean grotesk (Inter or
>   similar) for body text and table content.
> - **Shape language**: rounded corners throughout (12–16px on cards, full-pill on badges and
>   small buttons), soft card shadows instead of hard borders, generous white space between card
>   sections.
> - **Core reusable components**: status pill badges (colored background, colored text, small dot
>   or icon), stat/metric cards (icon in a tinted circle + big number + small trend label), a
>   step-progress indicator (numbered circles connected by a line, used in the booking wizard),
>   bottom sheets for mobile actions, a card-based table row pattern (avatar/icon + two lines of
>   text + right-aligned status/amount) that appears in almost every list screen across all three
>   apps.
> - **Dark mode**: not required today, but design with CSS variables/tokens so it could be added
>   later without a rebuild.

---

## 1. Client App (consumer-facing, mobile-first, light theme)

Audience: a business owner or logistics coordinator booking truck shipments — not a power user,
should feel as easy as a consumer ride-hailing app.

### 1.1 Home / Dashboard
> The client's home screen after login — a personal shipment dashboard, not a generic landing
> page. Include: a greeting header; four stat cards in a row (Total Bookings, Total Cancelled,
> Total Paid, Active Bookings — icon + big number, no charts); a "Booking Information" table
> (columns: Driver, Truck Type, Route, Status, and a kebab-menu per row with View Details /
> Download Invoice); a right-hand "Active Rides" panel showing 2-3 route-progress cards (pickup →
> progress rail → drop, with a highlighted card for the most-advanced shipment) plus a search box;
> a floating "+" quick-action button bottom-right that fans out into 3-4 circular action buttons
> (New Booking, Track Shipment, Support, etc.) on hover/tap in a quarter-circle arc.

### 1.2 Book a Truck — multi-step wizard
> A 5-step booking wizard with a step-progress indicator at the top (Location → Load Info → Truck
> Selection → Review → Broker/Driver). Design each step as its own screen:
> - **Step 1 (Location)**: pickup/drop address autocomplete fields connected by a dashed vertical
>   line with a swap-direction icon button, plus two pill buttons below to add extra loading/
>   unloading stops (Ola/Uber-style "add stop"), and an auto-detected Intra-City/Inter-City badge.
> - **Step 2 (Load Info)**: material type, weight, quantity, special instructions form.
> - **Step 3 (Truck Selection)**: a grid of truck-type cards (icon, name, capacity, price) plus a
>   live map showing nearby available trucks.
> - **Step 4 (Review)**: a summary card with the pickup→drop rail (including any extra stops),
>   truck/weight/material details, and a price breakdown (base fare, distance fare, traffic
>   surcharge, platform fee, total).
> - **Step 5 (Negotiation handoff)**: a single-card "waiting for a driver/broker to respond"
>   state with a spinner, transitioning to an accept/decline/counter-offer card once someone
>   responds, and a bottom sheet with a price slider for making a counter-offer.

### 1.3 Track Shipment
> A live tracking screen: search bar by booking ID at the top; left column has a booking summary
> card (pickup→drop rail with any stops, status badge, driver contact, weight/amount stat tiles);
> right column (3/5 width) is a large live map card with a rotated truck marker, numbered stop
> pins, a "Live Tracking" or "Delivered" chip top-left, a booking-ID chip top-right, and an ETA/
> delivered-at chip bottom-right. Include an incident banner variant (amber, warning icon) that
> can appear above the map when the driver reports a problem.

### 1.4 Booking Detail
> A single booking's full detail page: header with status badge and booking ref; timeline/rail of
> the shipment's stops; a payment summary card (Pay Now / Pay Later actions when unpaid); a
> negotiation panel (shown only while a driver/broker request is still pending — same accept/
> decline/waiting pattern as the wizard's Step 5); invoice actions (download, email, share via
> WhatsApp) once delivered; a cancel-booking action (opens a reason bottom sheet) visible only
> before pickup.

---

## 2. Driver / Broker App (mobile-first, two personas, light theme with slate-toned text)

### 2.1 Driver — Home / Active Trip ("My Trip")
> A driver's active-delivery screen: header card with booking ref, pickup→drop title, a status
> badge and an "online/offline" toggle in the top bar; a live map card showing the route and a
> rotated truck marker; a compact loading/unloading stop checklist (only shown when the booking
> has extra stops — icon + address + Done/Pending pill per stop); a big primary action button that
> changes label by status (Start Trip to Pickup → Mark Picked Up → Start Delivery → Mark
> Delivered), disabled with an inline reason when a stop checklist blocks it; a stat row (Distance,
> Est. Time, Earnings); Chat and SOS buttons top-right; a cargo-details card and a contact card
> below the fold.

### 2.2 Driver — Delivery Completion Flow
> A focused multi-step wizard (not the main trip screen) for wrapping up a delivery: a compact
> step-progress bar (Arrived → Upload → Payments → Complete). Steps: swipe-to-confirm arrival;
> a proof-of-delivery photo grid uploader (up to 6 photos); a payment-collection screen showing
> amount due, the driver's UPI QR code (with an upload/replace action), and "Payment Received via
> UPI" / "Collect Cash" buttons; a final success/checkmark screen.

### 2.3 Driver — Requests (negotiation inbox)
> A card grid of incoming trip offers, each card showing client name/route/amount and an
> Accept/Counter/Decline button row while open, collapsing to a colored status pill once
> responded (amber "waiting for client" / green "trip confirmed" / grey "declined" / a locked
> state with a lock icon once a 2-minute response window has passed and the broker has taken
> over). A counter-offer opens a bottom sheet with a price slider.

### 2.4 Broker — Dashboard
> An operations overview for a fleet owner: stat cards (active trucks, active drivers, jobs in
> progress, this month's earnings); a jobs-needing-attention list; a small earnings trend chart.

### 2.5 Broker — Job Requests / Driver Requests
> Two related inbox screens (client offers awaiting broker response, and driver offers awaiting
> driver response that the broker can act on after timeout) — same card-list pattern as 2.3, plus
> an inline "assign a driver" panel (driver + truck picker) shown once a job is accepted, with a
> "waiting for driver to respond" status once assigned.

### 2.6 Broker — Fleet (Drivers / Trucks lists + detail)
> Two list screens (drivers, trucks) using the card-row pattern (avatar/icon, name, status pill,
> key stat), each opening a detail page with profile info, current status, and a trip-history
> table. Trucks list includes a live-location modal/mini-map per truck.

### 2.7 Broker — Job Detail
> A single booking's full operational detail for the broker: route map + stop checklist (mirrors
> 2.1's driver view, read-only unless completing a delivery on the driver's behalf), job
> details card (truck, driver, date, distance, cargo), earnings & payment stat grid, invoice
> actions, and a "Complete Delivery" action that opens the same completion flow as 2.2 when a
> trip is delivered but not yet closed out.

---

## 3. Admin Dashboard (desktop-first, data-dense, dark-navy accents)

### 3.1 Overview Dashboard
> The admin landing page: a row of KPI stat cards (Total Bookings, Registered Trucks, Active
> Trips, Total Revenue — each with an up/down trend badge vs. last 30 days); a GMV/revenue trend
> chart; a top-clients table; a fleet-utilization chart per broker; a stale-pending-bookings
> alert card.

### 3.2 Live Tracking — List + Map
> A List/Map toggle screen for every GPS-tracked vehicle. **List**: search bar, a table (Name,
> IMEI, Status pill, Speed, Ignition, Last Update, view action) with pagination, an amber banner
> when falling back to last-known-position data. **Map**: the same devices as pins on a full-width
> map, using a distinct 3D-styled rotated truck icon (gradient-shaded, drop shadow — not a flat
> top-down silhouette) that points in the vehicle's heading direction, clustering/clicking a pin
> opens the detail page.

### 3.3 Tracking Detail
> A single device's detail page: header (device name, status badge, IMEI); a compact quick-stats
> strip (Speed, Heading, Ignition, Last Update — 4 tiles, no scrolling needed to see these); a
> live map card; below it, a **grouped compact tile grid** (not stacked full-width rows) for every
> other vendor field — Identity, Motion, Power & Sensors, Distance & Location, History & Meta
> sections, each a small multi-column grid of label/value tiles.

### 3.4 Bookings — List + Detail
> A bookings table (ref, client, route, truck type, status pill, amount, date, actions) with
> filters and pagination; a detail page showing the full timeline, assigned broker/driver/truck,
> pricing breakdown, and admin-only actions (reassign, cancel, view disputes).

### 3.5 Trucks / Drivers / Users — List + Detail
> Standard admin CRUD list-and-detail pattern reused across these three entity types: searchable/
> filterable table with a status pill column, a detail drawer or page with profile info, KYC
> document viewer (for drivers/brokers), and an activity/trip-history table.

### 3.6 Invoices / Settlements / Disputes
> Financial-ops tables: Invoices (booking ref, client, amount, payment status pill, download
> action), Settlements (broker, period, gross/platform-fee/net columns, paid/pending status),
> Disputes (booking ref, reason, status pill, an open-under-review-resolved workflow with a
> resolution notes field).

---

## Notes for whoever runs these through Stitch

- Generate the **Design System** screen/style guide first and lock it as the base style for the
  whole project before generating any of the screens above — Stitch reuses whatever tokens/
  components it establishes first.
- Where a screen says "same pattern as X.Y," generate X.Y first so Stitch has it in context to
  reuse rather than reinventing a slightly different card style each time.
- Keep prompts about **status pills and badges** consistent across every screen — they're the
  single most-reused component in this product (negotiation status, trip status, payment status,
  device status, KYC status all use the same visual pattern today) and the biggest place visual
  drift would show if generated independently per screen.
