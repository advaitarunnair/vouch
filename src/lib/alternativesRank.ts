// Pure ranking for "safer alternatives" (unit-tested).
import { FAR_BELOW_RATIO, type MarketOffer } from "@/lib/priceCheck";

export type RetailerTrust = "established" | "unverified" | "new";

export interface RankedAlternative {
  product_id: string;
  title: string;
  price: number;
  currency: string;
  domain: string;
  url: string;
  trust: RetailerTrust;
  domain_age_years: number | null;
}

export const RETAILER_TRUST_LABEL: Record<RetailerTrust, string> = {
  established: "Established retailer",
  unverified: "Unverified retailer",
  new: "New website",
};

export function retailerTrust(ageDays: number | null): RetailerTrust {
  if (ageDays === null) return "unverified";
  if (ageDays >= 5 * 365) return "established";
  if (ageDays >= 365) return "unverified";
  return "new";
}

const TRUST_RANK: Record<RetailerTrust, number> = { established: 0, unverified: 1, new: 2 };

/**
 * One offer per product, excluding the shop being checked, suspiciously cheap offers and
 * brand-new websites; sorted by retailer trust, then price.
 */
export function rankAlternatives(
  offers: MarketOffer[],
  opts: { median: number | null; excludeHost?: string | null; ageDays: (domain: string) => number | null; limit?: number },
): RankedAlternative[] {
  const host = opts.excludeHost?.replace(/^www\./, "").toLowerCase();
  const candidates = offers
    .filter((o) => !(host && (o.domain === host || o.domain.endsWith(`.${host}`))))
    .filter((o) => !(opts.median !== null && o.price < opts.median * FAR_BELOW_RATIO))
    .map((o): RankedAlternative => {
      const age = opts.ageDays(o.domain);
      return {
        product_id: o.product_id,
        title: o.title,
        price: o.price,
        currency: o.currency,
        domain: o.domain,
        url: o.url,
        trust: retailerTrust(age),
        domain_age_years: age === null ? null : Math.floor(age / 365),
      };
    })
    .filter((a) => a.trust !== "new")
    .sort((a, b) => TRUST_RANK[a.trust] - TRUST_RANK[b.trust] || a.price - b.price);

  // Greedy pick in trust-then-price order: each product once, each retailer once (for variety).
  const usedProducts = new Set<string>();
  const usedDomains = new Set<string>();
  const picked: RankedAlternative[] = [];
  for (const a of candidates) {
    if (usedProducts.has(a.product_id) || usedDomains.has(a.domain)) continue;
    usedProducts.add(a.product_id);
    usedDomains.add(a.domain);
    picked.push(a);
    if (picked.length >= (opts.limit ?? 4)) break;
  }
  return picked;
}
