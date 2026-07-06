const pool = require('../config/db');

// Fixed singleton row id — see db/10settings_pricing.sql
const PRICING_CONFIG_ID = '00000000-0000-0000-0000-000000000001';

const round2 = (n) => Math.round(n * 100) / 100;

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
  //   - part-load (truckCategory === 'part')          -> { totalTruckCost, capacityUsedPct, platformFee, total, distance }
  //   - intra-city (small/medium/large + transportType 'intra') -> { baseFare, distance, distanceFare, subtotal, platformFee, total }
  //   - inter-city (transportType 'inter')             -> both a client view (distanceFare/subtotal) and
  //                                                        an admin view (fuel/toll) are returned; controller picks by role.
  static async estimate({ truckCategory, transportType, distance, capacityUsedPct }) {
    const configRow = await this.getConfig();
    if (!configRow) throw new Error('Pricing configuration not found');
    const config = configRow.config;
    const dist = Number(distance) || 0;

    if (truckCategory === 'part') {
      const cfg = config.partTruck || {};
      const pct = capacityUsedPct != null ? Math.min(100, Math.max(0, Number(capacityUsedPct))) : 100;
      // No standalone "full truck" cost table exists yet — approximate a full truck's
      // linehaul cost off the inter-city per-km rate, then scale down by capacity used.
      const fullTruckCost = dist * (config.interCity?.baseRatePerKm || 0);
      const totalTruckCost = round2(fullTruckCost * (pct / 100));
      const platformFee = round2(totalTruckCost * (cfg.platformFee || 0));
      return {
        totalTruckCost,
        capacityUsedPct: pct,
        platformFee,
        total: round2(totalTruckCost + platformFee),
        distance: dist,
      };
    }

    if (transportType === 'inter') {
      const cfg = config.interCity || {};
      const baseFare = round2(dist * (cfg.baseRatePerKm || 0));
      const fuel = round2(baseFare * (cfg.fuelSurcharge || 0));
      const toll = cfg.tollHandling === 'fixed' ? Number(cfg.tollFixedAmount || 0) : Number(cfg.tollFixedAmount || 0);
      const subtotal = round2(baseFare + fuel + toll);
      const platformFee = round2(subtotal * (cfg.platformFee || 0));
      const total = round2(subtotal + platformFee);
      return {
        baseFare,
        distance: dist,
        distanceFare: round2(fuel + toll), // client view groups fuel+toll into one distance-based figure
        subtotal,
        fuel,
        toll,
        platformFee,
        total,
      };
    }

    // intra-city — keyed per truck category (default to medium if an unknown category slips through)
    const cfg = (config.intraCity && config.intraCity[truckCategory]) || config.intraCity?.medium || {};
    const baseFare = Number(cfg.baseFare || 0);
    const distanceFare = round2(dist * (cfg.perKmRate || 0) * (cfg.demandMultiplier || 1));
    const subtotal = round2(baseFare + distanceFare);
    const platformFee = round2(subtotal * (cfg.platformFee || 0));
    const total = round2(subtotal + platformFee);
    return { baseFare, distance: dist, distanceFare, subtotal, platformFee, total };
  }
}

module.exports = PricingModel;
