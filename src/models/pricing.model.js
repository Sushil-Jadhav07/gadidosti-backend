const pool = require('../config/db');
const TruckModel = require('./truck.model');

// Fixed singleton row id — see db/10settings_pricing.sql
const PRICING_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

// Supply-based pricing: when more than this many available trucks are within radius of the
// pickup point, this is treated as a high-activity pickup zone and the fare surges by
// SUPPLY_SURGE_MULTIPLIER. Radius matches NearbyTrucksMap.jsx's default search radius, so
// "nearby" means the same thing here as it does on the client's own truck-selection map.
const NEARBY_SURGE_THRESHOLD_TRUCKS = 5;
const NEARBY_SURGE_RADIUS_KM = 10;
const NEARBY_SURGE_MULTIPLIER = 1.05;

const round2 = (n) => Math.round(n * 100) / 100;

// ─── VEHICLE PRICING (replaces the old flat per-category intra/inter split) ────────────────────
// One unified, distance-tiered rate card per specific truck type — the per-km rate depends on
// how far the trip is (shorter trips cost more per km), not on whether it's "intra-city" or
// "inter-city"; that split still exists elsewhere (halting grace periods, SLA) but no longer
// drives the base fare itself. Confirmed rate card, one column per truck type.
const DISTANCE_BANDS_KM = [25, 50, 100, 300, 1000, 1500, 2000, null];

const DEFAULT_VEHICLE_PRICING = {
  '3_wheeler':   { minimumFare: 400,  ratesByBand: [35, 27, 32, 17, 12, 12, 12, 12] },
  tata_ace:      { minimumFare: 800,  ratesByBand: [55, 32, 37, 20, 13, 13, 13, 13] },
  pickup_8ft:    { minimumFare: 900,  ratesByBand: [65, 37, 47, 26, 15, 15, 15, 15] },
  pickup_10ft:   { minimumFare: 1000, ratesByBand: [80, 53, 70, 30, 16, 16, 16, 16] },
  '14ft':        { minimumFare: 1700, ratesByBand: [110, 68, 88, 33, 20, 20, 20, 20] },
  '17ft':        { minimumFare: 2700, ratesByBand: [160, 100, 128, 36, 21, 21, 21, 21] },
  '19ft':        { minimumFare: 3800, ratesByBand: [210, 122, 146, 40, 23, 23, 23, 23] },
  '22ft':        { minimumFare: 4400, ratesByBand: [250, 142, 161, 43, 25, 25, 25, 25] },
  '32ft_sxl':    { minimumFare: 5500, ratesByBand: [290, 165, 185, 48, 28, 28, 28, 28] },
  '32ft_mxl':    { minimumFare: 7000, ratesByBand: [340, 195, 215, 55, 32, 32, 32, 32] },
};

// Flat per-km rates for a handful of far/harder-to-reach regions — override the distance-band
// lookup above entirely when the drop-off falls in one of these zones (see getRegionZoneForState),
// since a plain distance-based rate would undercharge routes that are this far out regardless of
// exact km (tolls/permits/return-load scarcity). Priced above even the longest distance band.
const DEFAULT_REGION_RATES = {
  southEast:    { '3_wheeler': 17, tata_ace: 18, pickup_8ft: 20, pickup_10ft: 22, '14ft': 25, '17ft': 26, '19ft': 28, '22ft': 30, '32ft_sxl': 33, '32ft_mxl': 37 },
  guwahatiSide: { '3_wheeler': 20, tata_ace: 21, pickup_8ft: 23, pickup_10ft: 24, '14ft': 27, '17ft': 29, '19ft': 31, '22ft': 33, '32ft_sxl': 36, '32ft_mxl': 40 },
  kerala:       { '3_wheeler': 22, tata_ace: 25, pickup_8ft: 26, pickup_10ft: 26, '14ft': 29, '17ft': 31, '19ft': 33, '22ft': 35, '32ft_sxl': 38, '32ft_mxl': 42 },
};

// Which Indian states count as each named zone — a judgment call (not given explicitly), kept
// here as plain admin-editable config rather than hardcoded logic so it can be corrected without
// a deploy. southEast: the non-Kerala South, since Kerala gets its own row on the rate card.
// guwahatiSide: the North-East states. Matched case-insensitively against the drop address's
// state text (see getRegionZoneForState) — no drop state resolved just skips regional pricing
// entirely and falls back to the normal distance band, same as an unmatched state would.
const DEFAULT_REGION_ZONES = {
  southEast: ['Tamil Nadu', 'Andhra Pradesh', 'Telangana', 'Karnataka', 'Puducherry'],
  guwahatiSide: ['Assam', 'Meghalaya', 'Manipur', 'Mizoram', 'Nagaland', 'Tripura', 'Arunachal Pradesh', 'Sikkim'],
  kerala: ['Kerala'],
};

// Old trucks/bookings that still carry a pre-retaxonomy category ('small'/'medium'/'large') —
// kept valid in the DB (existing rows aren't force-migrated, see db/51vehicle_pricing.sql) but
// need *some* vehicle-pricing entry to compute a fare against. Maps each to the new type it's
// closest to, for pricing purposes only — never rewrites the stored category itself.
const LEGACY_CATEGORY_TO_VEHICLE_TYPE = { small: 'pickup_8ft', medium: '14ft', large: '19ft' };

// Same legacy trucks, but for the *other* direction: getHaltingRate below still reads the old
// small/medium/large waitingCharge buckets (unchanged, out of scope for this pricing update), so
// a new-taxonomy category needs to resolve back down to one of those three buckets.
const VEHICLE_TYPE_TO_LEGACY_BUCKET = {
  '3_wheeler': 'small', tata_ace: 'small', pickup_8ft: 'small',
  pickup_10ft: 'medium', '14ft': 'medium',
  '17ft': 'large', '19ft': 'large', '22ft': 'large', '32ft_sxl': 'large', '32ft_mxl': 'large',
};

const resolveVehicleTypeKey = (truckCategory) => {
  if (DEFAULT_VEHICLE_PRICING[truckCategory]) return truckCategory;
  return LEGACY_CATEGORY_TO_VEHICLE_TYPE[truckCategory] || '14ft';
};

// Case-insensitive match of the drop-off state against the configured zones — null if it's
// blank or doesn't fall in any of them (normal distance-band pricing applies either way).
const getRegionZoneForState = (config, dropState) => {
  if (!dropState) return null;
  const zones = (config?.regionZones && Object.keys(config.regionZones).length) ? config.regionZones : DEFAULT_REGION_ZONES;
  const normalized = String(dropState).trim().toLowerCase();
  for (const [zoneKey, states] of Object.entries(zones)) {
    if ((states || []).some((s) => String(s).trim().toLowerCase() === normalized)) return zoneKey;
  }
  return null;
};

// The actual fare lookup — floors at minimumFare (a short trip is never cheaper than the floor),
// otherwise dist * the applicable per-km rate (region override if the drop state matches one of
// the named zones, else whichever distance band the total trip length falls into).
// baseFare/distanceFare split is cosmetic (existing UI shows them as two line items) but always
// sums to the true total: baseFare is exactly the minimum-fare floor, distanceFare is whatever's
// owed on top of it (0 whenever the trip doesn't clear the floor at all).
const computeVehicleFare = (distanceKm, truckCategory, dropState, config) => {
  const dist = Number(distanceKm) || 0;
  const key = resolveVehicleTypeKey(truckCategory);
  const pricing = (config?.vehiclePricing && config.vehiclePricing[key]) || DEFAULT_VEHICLE_PRICING[key];
  const minimumFare = Number(pricing.minimumFare) || 0;

  const zone = getRegionZoneForState(config, dropState);
  let ratePerKm = null;
  let regionApplied = null;
  if (zone) {
    const regionRates = (config?.regionRates && Object.keys(config.regionRates).length) ? config.regionRates : DEFAULT_REGION_RATES;
    const zoneRate = Number(regionRates?.[zone]?.[key]);
    if (zoneRate > 0) {
      ratePerKm = zoneRate;
      regionApplied = zone;
    }
  }
  if (ratePerKm == null) {
    const rates = pricing.ratesByBand || DEFAULT_VEHICLE_PRICING[key].ratesByBand;
    let idx = DISTANCE_BANDS_KM.findIndex((maxKm) => maxKm == null || dist <= maxKm);
    if (idx === -1) idx = DISTANCE_BANDS_KM.length - 1;
    ratePerKm = Number(rates[idx]) || 0;
  }

  const rawFare = round2(dist * ratePerKm);
  const baseFare = minimumFare;
  const distanceFare = round2(Math.max(0, rawFare - minimumFare));
  const subtotal = round2(baseFare + distanceFare);
  return { baseFare, distanceFare, subtotal, ratePerKm, minimumFareApplied: rawFare < minimumFare, regionApplied };
};

// Inter-city halting: above a 200km base threshold, a distance-tiered free grace period applies
// before halting charges kick in (confirmed design — three tiers by distance band). The overage
// rate reuses each truck category's existing (previously dead) intraCity.<category>.waitingCharge
// per-hour rate from pricing_config rather than a new field, since inter-city pricing has no
// per-category breakdown of its own.
const HALTING_BASE_THRESHOLD_KM = 200;
const HALTING_TIERS = [
  { minKm: 200, maxKm: 400, graceHours: 6 },
  { minKm: 400, maxKm: 600, graceHours: 8 },
  { minKm: 600, maxKm: Infinity, graceHours: 12 },
];

// Grace-period info for a given distance — null if the booking is at/under the base threshold
// (halting charges don't apply at all). Used both for informational display at quote time and
// as the single source of truth for the actual overage computation at delivery time.
const getHaltingTier = (distanceKm) => {
  const dist = Number(distanceKm) || 0;
  if (dist <= HALTING_BASE_THRESHOLD_KM) return null;
  return HALTING_TIERS.find((t) => dist > t.minKm && dist <= t.maxKm) || HALTING_TIERS[HALTING_TIERS.length - 1];
};

// Per-hour overage rate for a truck category — the waiting-charge buckets themselves are still
// only small/medium/large (unchanged, out of scope for the vehicle-pricing retaxonomy above), so
// any of the 8 new specific truck types resolves down to whichever bucket it's closest in size to
// (see VEHICLE_TYPE_TO_LEGACY_BUCKET), falling back to 'medium' only for 'part' or anything
// genuinely unrecognized.
const getHaltingRate = (config, truckCategory) => {
  const category = ['small', 'medium', 'large'].includes(truckCategory)
    ? truckCategory
    : (VEHICLE_TYPE_TO_LEGACY_BUCKET[truckCategory] || 'medium');
  return Number(config?.intraCity?.[category]?.waitingCharge || 0);
};

// Advance-payment rule — configurable via pricing_config.advanceRule.tiers (admin dashboard),
// falling back to these defaults until an admin has ever saved that section. Confirmed design:
// three tiers by booking amount, first two flat, the top one a percentage. Ordered ascending by
// maxAmount; the last tier's maxAmount is null (open-ended — "above ₹10,000").
const DEFAULT_ADVANCE_TIERS = [
  { maxAmount: 5000, type: 'flat', value: 1000 },
  { maxAmount: 10000, type: 'flat', value: 2000 },
  { maxAmount: null, type: 'percent', value: 0.8 },
];

// The advance amount for a given booking amount — never more than the amount itself (a tiny
// booking under a tier's flat value shouldn't ever require "more than 100% up front"). Used both
// at payment time (booking.controller.js) and for display before that (GET .../advance-amount).
const computeAdvanceAmount = (amount, advanceRuleConfig) => {
  const amt = Number(amount) || 0;
  const tiers = advanceRuleConfig?.tiers?.length ? advanceRuleConfig.tiers : DEFAULT_ADVANCE_TIERS;
  const tier = tiers.find((t) => t.maxAmount == null || amt <= Number(t.maxAmount)) || tiers[tiers.length - 1];
  const raw = tier.type === 'percent' ? amt * Number(tier.value) : Number(tier.value);
  return Math.min(round2(raw), amt);
};

// Delivery SLA — distance-tiered "expected total delivery time" (door-to-door, not just time
// spent halted — see HALTING_TIERS above for that separate, smaller-scale concept). Confirmed
// design: three tiers by distance. Admin-configurable via pricing_config.deliverySla.tiers,
// falling back to these defaults until an admin has ever saved that section.
const DEFAULT_SLA_TIERS = [
  { maxKm: 300, hours: 36 },
  { maxKm: 1000, hours: 48 },
  { maxKm: null, hours: 120 },
];

// Express Delivery — intra-city-only (confirmed scope), a faster/costlier service tier: the
// normal freight amount plus a surcharge, and the normal SLA hours multiplied down (a smaller
// factor = a tighter deadline). Admin-configurable via pricing_config.expressService, falling
// back to these defaults (20% surcharge, 40% faster i.e. 0.6x the normal hours) until saved.
const DEFAULT_EXPRESS_SERVICE = {
  surchargePct: 0.2,
  slaFactor: 0.6,
  includesInsurance: true,
};

// The expected total delivery time (hours) for a given distance — the single source of truth
// for both informational display at quote time and the actual overage computation at delivery
// time (see trip.controller.js's applyHaltingCharge, which now also calls this).
const getExpectedDeliveryHours = (distanceKm, deliverySlaConfig) => {
  const dist = Number(distanceKm) || 0;
  const tiers = deliverySlaConfig?.tiers?.length ? deliverySlaConfig.tiers : DEFAULT_SLA_TIERS;
  const tier = tiers.find((t) => t.maxKm == null || dist <= Number(t.maxKm)) || tiers[tiers.length - 1];
  return Number(tier.hours) || 0;
};

const getExpressService = (config) => ({ ...DEFAULT_EXPRESS_SERVICE, ...(config?.expressService || {}) });

// Estimated delivery date — a coarse, day-granularity figure shown to the client before booking
// confirmation, distinct from getExpectedDeliveryHours above (that's the hour-precision SLA
// used for delay-charge billing; this is purely informational). The confirmed anchors were
// given as an irregular set of overlapping-if-taken-literally points ("300-500km -> ~2 days",
// "500+km -> T+3", "~1000km -> T+4", "~2000km -> T+5") — resolved here into clean, non-
// overlapping bands per the explicit "avoid overlapping ranges" instruction: 500+ describes the
// tier that starts at 500, and 1000/2000 are the next two tiers' own anchors. The sub-300km
// floor (T+1) wasn't specified at all — a judgment call for anything shorter than the shortest
// given anchor, not derived from any given number.
const DEFAULT_DELIVERY_DATE_TIERS = [
  { maxKm: 300, days: 1 },
  { maxKm: 500, days: 2 },
  { maxKm: 1000, days: 3 },
  { maxKm: 2000, days: 4 },
  { maxKm: null, days: 5 },
];

const getEstimatedDeliveryDays = (distanceKm, deliveryDateConfig) => {
  const dist = Number(distanceKm) || 0;
  const tiers = deliveryDateConfig?.tiers?.length ? deliveryDateConfig.tiers : DEFAULT_DELIVERY_DATE_TIERS;
  const tier = tiers.find((t) => t.maxKm == null || dist <= Number(t.maxKm)) || tiers[tiers.length - 1];
  return Number(tier.days) || 0;
};

// Traffic-aware dynamic pricing — a single multiplier layered on top of the existing
// static pricing_config rates, not stored/configurable there. ratio = how much longer the
// live-traffic ETA is vs. the traffic-free duration; tiers below cap the surge at 1.5x so a
// single bad-traffic estimate can't blow up the fare. Missing/zero durations -> ratio 1.0
// (no surge) rather than throwing, since duration data is best-effort (see
// GoogleMapsLocationProvider.getDistance / FakeLocationProvider.getDistance).
const TRAFFIC_TIERS = [
  { maxRatio: 1.1, multiplier: 1.0 },
  { maxRatio: 1.3, multiplier: 1.15 },
  { maxRatio: 1.6, multiplier: 1.3 },
  { maxRatio: Infinity, multiplier: 1.5 },
];

const getTrafficMultiplier = (durationMin, durationInTrafficMin) => {
  const base = Number(durationMin);
  const traffic = Number(durationInTrafficMin);
  if (!base || !traffic || base <= 0) return 1.0;
  const ratio = traffic / base;
  return TRAFFIC_TIERS.find((tier) => ratio <= tier.maxRatio).multiplier;
};

class PricingModel {
  static async getConfig() {
    const result = await pool.query(`SELECT id, config, updated_at FROM pricing_config WHERE id = $1`, [PRICING_CONFIG_ID]);
    return result.rows[0] || null;
  }

  static async updateConfig(config) {
    const result = await pool.query(
      `UPDATE pricing_config SET config = $1::jsonb, updated_at = NOW() WHERE id = $2
       RETURNING id, config, updated_at`,
      [JSON.stringify(config), PRICING_CONFIG_ID]
    );
    return result.rows[0] || null;
  }

  // Computes a quote from the current pricing_config. Shape of the returned
  // breakdown depends on truckCategory/transportType (see gap doc §2):
  //   - part-load (truckCategory === 'part')          -> { totalTruckCost, capacityUsedPct, trafficMultiplier, trafficSurcharge, platformFee, total, distance }
  //   - intra-city (small/medium/large + transportType 'intra') -> { baseFare, distance, distanceFare, subtotal, trafficMultiplier, trafficSurcharge, platformFee, total }
  //   - inter-city (transportType 'inter')             -> both a client view (distanceFare/subtotal) and
  //                                                        an admin view (fuel/toll) are returned; controller picks by role.
  // durationMin/durationInTrafficMin are optional — when given (from config.controller.js's
  // getDistance, which the frontend calls first), a traffic surge multiplier is layered on
  // top of the existing static rate; when omitted, trafficMultiplier is 1.0 (no surge, no
  // behavior change from before this multiplier existed).
  static async estimate({
    truckCategory, transportType, distance, capacityUsedPct, durationMin, durationInTrafficMin,
    pickupLat, pickupLng, isExpress, dropState,
  }) {
    const configRow = await this.getConfig();
    if (!configRow) throw new Error('Pricing configuration not found');
    const config = configRow.config;
    const dist = Number(distance) || 0;
    const trafficMultiplier = getTrafficMultiplier(durationMin, durationInTrafficMin);
    // Express Delivery is intra-city-only (confirmed scope) — silently ignored for inter-city/
    // part-load rather than erroring, since the caller may not know that rule; the controller
    // also guards this at the validation layer so a client can't be quietly charged for
    // something they didn't actually get.
    const expressActive = !!isExpress && transportType !== 'inter' && truckCategory !== 'part';
    const expressCfg = getExpressService(config);

    // Only computed when the caller actually has a pickup point (quoteBooking/createBooking
    // both do; anything calling estimate() without coordinates just gets no surge, same as
    // omitting durationMin/durationInTrafficMin skips the traffic multiplier above).
    let nearbyTruckCount = null;
    let supplyMultiplier = 1;
    if (pickupLat != null && pickupLng != null) {
      const nearby = await TruckModel.findNearby({
        lat: pickupLat, lng: pickupLng, radiusKm: NEARBY_SURGE_RADIUS_KM, limit: 1,
      });
      nearbyTruckCount = nearby.total;
      if (nearbyTruckCount > NEARBY_SURGE_THRESHOLD_TRUCKS) supplyMultiplier = NEARBY_SURGE_MULTIPLIER;
    }

    if (truckCategory === 'part') {
      const cfg = config.partTruck || {};
      const pct = capacityUsedPct != null ? Math.min(100, Math.max(0, Number(capacityUsedPct))) : 100;
      // No standalone "full truck" cost table exists yet — approximate a full truck's
      // linehaul cost off the inter-city per-km rate, then scale down by capacity used.
      const fullTruckCost = dist * (config.interCity?.baseRatePerKm || 0);
      const totalTruckCost = round2(fullTruckCost * (pct / 100));
      const trafficSurcharge = round2(totalTruckCost * (trafficMultiplier - 1));
      const supplySurcharge = round2(totalTruckCost * (supplyMultiplier - 1));
      const adjustedTruckCost = round2(totalTruckCost + trafficSurcharge + supplySurcharge);
      const platformFee = round2(adjustedTruckCost * (cfg.platformFee || 0));
      return {
        totalTruckCost,
        capacityUsedPct: pct,
        trafficMultiplier,
        trafficSurcharge,
        nearbyTruckCount,
        supplyMultiplier,
        supplySurcharge,
        platformFee,
        total: round2(adjustedTruckCost + platformFee),
        distance: dist,
        // Pre-existing gap: this branch never set this, which crashed quoteBooking (every
        // caller unconditionally does `breakdown.estimatedDeliveryDays * ...` to build
        // estimatedDeliveryDate) — 500'd with "Invalid time value" for every 'part' quote.
        estimatedDeliveryDays: getEstimatedDeliveryDays(dist, config.deliveryDateEstimate),
      };
    }

    // The base/distance fare itself now comes from the unified vehicle-pricing rate card
    // (computeVehicleFare) regardless of intra/inter — fuel surcharge, toll and platform fee
    // stay wired to their existing admin-configurable places (config.interCity /
    // config.intraCity[<legacy bucket>]) since this update didn't touch those.
    const legacyBucket = ['small', 'medium', 'large'].includes(truckCategory)
      ? truckCategory
      : (VEHICLE_TYPE_TO_LEGACY_BUCKET[truckCategory] || 'medium');

    if (transportType === 'inter') {
      const cfg = config.interCity || {};
      const { baseFare, distanceFare, ratePerKm, minimumFareApplied, regionApplied } = computeVehicleFare(dist, truckCategory, dropState, config);
      const fuel = round2((baseFare + distanceFare) * (cfg.fuelSurcharge || 0));
      const toll = cfg.tollHandling === 'fixed' ? Number(cfg.tollFixedAmount || 0) : Number(cfg.tollFixedAmount || 0);
      const subtotal = round2(baseFare + distanceFare + fuel + toll);
      const trafficSurcharge = round2(subtotal * (trafficMultiplier - 1));
      const supplySurcharge = round2(subtotal * (supplyMultiplier - 1));
      const adjustedSubtotal = round2(subtotal + trafficSurcharge + supplySurcharge);
      const platformFee = round2(adjustedSubtotal * (cfg.platformFee || 0));
      const total = round2(adjustedSubtotal + platformFee);
      const haltingTier = getHaltingTier(dist);
      return {
        baseFare,
        distance: dist,
        distanceFare: round2(distanceFare + fuel + toll), // client view groups distance+fuel+toll into one figure
        subtotal,
        fuel,
        toll,
        ratePerKm,
        minimumFareApplied,
        regionApplied,
        trafficMultiplier,
        trafficSurcharge,
        nearbyTruckCount,
        supplyMultiplier,
        supplySurcharge,
        platformFee,
        total,
        // Informational only — the actual overage charge is computed at delivery time (see
        // trip.controller.js's applyHaltingCharge), once the real elapsed duration is known.
        halting: haltingTier ? {
          graceHours: haltingTier.graceHours,
          ratePerHour: getHaltingRate(config, truckCategory),
        } : null,
        // Total door-to-door SLA (distinct from the halting grace period above) — Express
        // doesn't apply to inter-city bookings (confirmed scope), so this is always the normal,
        // un-tightened figure here.
        expectedDeliveryHours: getExpectedDeliveryHours(dist, config.deliverySla),
        estimatedDeliveryDays: getEstimatedDeliveryDays(dist, config.deliveryDateEstimate),
      };
    }

    // intra-city — platformFee still comes from the legacy per-bucket config (unchanged); the
    // fare itself is the same unified vehicle-pricing lookup used above.
    const cfg = (config.intraCity && config.intraCity[legacyBucket]) || config.intraCity?.medium || {};
    const { baseFare, distanceFare, ratePerKm, minimumFareApplied, regionApplied } = computeVehicleFare(dist, truckCategory, dropState, config);
    const subtotal = round2(baseFare + distanceFare);
    const trafficSurcharge = round2(subtotal * (trafficMultiplier - 1));
    const supplySurcharge = round2(subtotal * (supplyMultiplier - 1));
    const adjustedSubtotal = round2(subtotal + trafficSurcharge + supplySurcharge);
    const platformFee = round2(adjustedSubtotal * (cfg.platformFee || 0));
    const normalTotal = round2(adjustedSubtotal + platformFee);
    // Applied on top of the fully-computed normal total (matches the confirmed example: a
    // ₹20,000 normal freight becomes ₹24,000 Express at the default 20%) — not folded into
    // platformFee, so the breakdown can show it as its own clearly-labeled line item.
    const expressSurcharge = expressActive ? round2(normalTotal * expressCfg.surchargePct) : 0;
    const total = round2(normalTotal + expressSurcharge);
    // Informational at quote time; the actual overage charge (if any) is computed once the real
    // elapsed delivery duration is known — see trip.controller.js's applyHaltingCharge.
    const expectedDeliveryHours = expressActive
      ? round2(getExpectedDeliveryHours(dist, config.deliverySla) * expressCfg.slaFactor)
      : getExpectedDeliveryHours(dist, config.deliverySla);
    return {
      baseFare, distance: dist, distanceFare, subtotal, trafficMultiplier, trafficSurcharge,
      nearbyTruckCount, supplyMultiplier, supplySurcharge, platformFee, total,
      ratePerKm, minimumFareApplied, regionApplied,
      isExpress: expressActive,
      expressSurcharge,
      expectedDeliveryHours,
      expressInsuranceIncluded: expressActive && !!expressCfg.includesInsurance,
      estimatedDeliveryDays: getEstimatedDeliveryDays(dist, config.deliveryDateEstimate),
    };
  }
}

PricingModel.getHaltingTier = getHaltingTier;
PricingModel.getHaltingRate = getHaltingRate;
PricingModel.computeAdvanceAmount = computeAdvanceAmount;
PricingModel.computeVehicleFare = computeVehicleFare;
PricingModel.getRegionZoneForState = getRegionZoneForState;
PricingModel.DEFAULT_VEHICLE_PRICING = DEFAULT_VEHICLE_PRICING;
PricingModel.DEFAULT_REGION_RATES = DEFAULT_REGION_RATES;
PricingModel.DEFAULT_REGION_ZONES = DEFAULT_REGION_ZONES;
PricingModel.DISTANCE_BANDS_KM = DISTANCE_BANDS_KM;
PricingModel.DEFAULT_ADVANCE_TIERS = DEFAULT_ADVANCE_TIERS;
PricingModel.HALTING_BASE_THRESHOLD_KM = HALTING_BASE_THRESHOLD_KM;
PricingModel.getExpectedDeliveryHours = getExpectedDeliveryHours;
PricingModel.getEstimatedDeliveryDays = getEstimatedDeliveryDays;
PricingModel.DEFAULT_DELIVERY_DATE_TIERS = DEFAULT_DELIVERY_DATE_TIERS;
PricingModel.getExpressService = getExpressService;
PricingModel.DEFAULT_SLA_TIERS = DEFAULT_SLA_TIERS;
PricingModel.DEFAULT_EXPRESS_SERVICE = DEFAULT_EXPRESS_SERVICE;

module.exports = PricingModel;
