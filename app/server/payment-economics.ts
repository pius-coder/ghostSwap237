/** Pure economics helpers for credit packs. Never mutates a wallet at runtime. */

export const PACK_CATALOG = [
  { name: 'Starter', credits: 18_000, priceXaf: 15_000, priceUsd: 30 },
  { name: 'Basic', credits: 36_000, priceXaf: 30_000, priceUsd: 60 },
  { name: 'Pro', credits: 72_000, priceXaf: 60_000, priceUsd: 120 },
  { name: 'Enterprise', credits: 180_000, priceXaf: 150_000, priceUsd: 300 },
] as const;

export const FAST_CREDITS_PER_SECOND = 2;
export const PRO_CREDITS_PER_SECOND = 80;
export const FAST_COST_USD_PER_SECOND = 0.0017;
/** Prudent Fast cost per credit = 0.0017 / 2 */
export const FAST_COST_USD_PER_CREDIT = 0.00085;
export const SAFETY_XAF_PER_USD = 650;
export const FAPSHI_FEE_RATE = 0.03;
export const CHARIOW_STARTER_FEE_RATE = 0.15;
export const MIN_GROSS_MARGIN = 0.3;

export function estimatedFastCostUsd(credits: number): number {
  return credits * FAST_COST_USD_PER_CREDIT;
}

export function fapshiNetUsd(priceXaf: number, feeRate = FAPSHI_FEE_RATE): number {
  return (priceXaf / SAFETY_XAF_PER_USD) * (1 - feeRate);
}

export function chariowNetUsd(priceUsd: number, feeRate = CHARIOW_STARTER_FEE_RATE): number {
  return priceUsd * (1 - feeRate);
}

/** Gross margin after estimated fees: (net − cost) / net */
export function grossMargin(netUsd: number, costUsd: number): number {
  if (netUsd <= 0) return Number.NEGATIVE_INFINITY;
  return (netUsd - costUsd) / netUsd;
}

export function packMargins() {
  return PACK_CATALOG.map((pack) => {
    const cost = estimatedFastCostUsd(pack.credits);
    const fapshiNet = fapshiNetUsd(pack.priceXaf);
    const chariowNet = chariowNetUsd(pack.priceUsd);
    return {
      name: pack.name,
      credits: pack.credits,
      fapshiMargin: grossMargin(fapshiNet, cost),
      chariowMargin: grossMargin(chariowNet, cost),
      fapshiNet,
      chariowNet,
      cost,
    };
  });
}
