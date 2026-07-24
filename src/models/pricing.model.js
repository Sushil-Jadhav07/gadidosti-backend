const pool = require('../config/db');

// Fixed singleton row id — see db/10settings_pricing.sql
const PRICING_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

const round2 = (n) => Math.round(n * 100) / 100;

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
  static async estimate({ truckCategory, transportType, distance, capacityUsedPct, durationMin, durationInTrafficMin }) {
    const configRow = await this.getConfig();
    if (!configRow) throw new Error('Pricing configuration not found');
    const config = configRow.config;
    const dist = Number(distance) || 0;
    const trafficMultiplier = getTrafficMultiplier(durationMin, durationInTrafficMin);

    if (truckCategory === 'part') {
      const cfg = config.partTruck || {};
      const pct = capacityUsedPct != null ? Math.min(100, Math.max(0, Number(capacityUsedPct))) : 100;
      // No standalone "full truck" cost table exists yet — approximate a full truck's
      // linehaul cost off the inter-city per-km rate, then scale down by capacity used.
      const fullTruckCost = dist * (config.interCity?.baseRatePerKm || 0);
      const totalTruckCost = round2(fullTruckCost * (pct / 100));
      const trafficSurcharge = round2(totalTruckCost * (trafficMultiplier - 1));
      const adjustedTruckCost = round2(totalTruckCost + trafficSurcharge);
      const platformFee = round2(adjustedTruckCost * (cfg.platformFee || 0));
      return {
        totalTruckCost,
        capacityUsedPct: pct,
        trafficMultiplier,
        trafficSurcharge,
        platformFee,
        total: round2(adjustedTruckCost + platformFee),
        distance: dist,
      };
    }

    if (transportType === 'inter') {
      const cfg = config.interCity || {};
      const baseFare = round2(dist * (cfg.baseRatePerKm || 0));
      const fuel = round2(baseFare * (cfg.fuelSurcharge || 0));
      const toll = cfg.tollHandling === 'fixed' ? Number(cfg.tollFixedAmount || 0) : Number(cfg.tollFixedAmount || 0);
      const subtotal = round2(baseFare + fuel + toll);
      const trafficSurcharge = round2(subtotal * (trafficMultiplier - 1));
      const adjustedSubtotal = round2(subtotal + trafficSurcharge);
      const platformFee = round2(adjustedSubtotal * (cfg.platformFee || 0));
      const total = round2(adjustedSubtotal + platformFee);
      return {
        baseFare,
        distance: dist,
        distanceFare: round2(fuel + toll), // client view groups fuel+toll into one distance-based figure
        subtotal,
        fuel,
        toll,
        trafficMultiplier,
        trafficSurcharge,
        platformFee,
        total,
      };
    }

    // intra-city — keyed per truck category (default to medium if an unknown category slips through)
    const cfg = (config.intraCity && config.intraCity[truckCategory]) || config.intraCity?.medium || {};
    const baseFare = Number(cfg.baseFare || 0);
    const distanceFare = round2(dist * (cfg.perKmRate || 0) * (cfg.demandMultiplier || 1));
    const subtotal = round2(baseFare + distanceFare);
    const trafficSurcharge = round2(subtotal * (trafficMultiplier - 1));
    const adjustedSubtotal = round2(subtotal + trafficSurcharge);
    const platformFee = round2(adjustedSubtotal * (cfg.platformFee || 0));
    const total = round2(adjustedSubtotal + platformFee);
    return { baseFare, distance: dist, distanceFare, subtotal, trafficMultiplier, trafficSurcharge, platformFee, total };
  }
}

module.exports = PricingModel;
