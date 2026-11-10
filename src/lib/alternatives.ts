import "server-only";
import { rankAlternatives, type RankedAlternative } from "@/lib/alternativesRank";
import { searchMarket } from "@/lib/channel3";
import type { CheckResult } from "@/lib/check/types";
import { domainAge } from "@/lib/rdap";

export interface AlternativesView {
  query: string | null;
  alternatives: RankedAlternative[];
  fetched_at: string | null;
  error?: string;
}

/**
 * Safer places to buy the same kind of product. Offers come from Channel3 (search results
 * are cached for at most 30 minutes, so links and prices are fresh); each retailer gets a
 * trust label from its domain age (RDAP, cached 24h).
 */
export async function alternativesFor(result: CheckResult): Promise<AlternativesView> {
  const query = result.price?.query ?? null;
  if (!query) return { query: null, alternatives: [], fetched_at: null, error: "No product to compare" };

  const market = await searchMarket(query);
  const domains = [...new Set(market.offers.map((o) => o.domain))].slice(0, 15);
  const ages = new Map<string, number | null>();
  await Promise.all(
    domains.map(async (d) => {
      const age = await domainAge(d).catch(() => null);
      ages.set(d, age?.age_days ?? null);
    }),
  );

  return {
    query,
    alternatives: rankAlternatives(market.offers, {
      median: result.price?.check.market_median ?? null,
      excludeHost: result.identification?.shop_domain,
      ageDays: (d) => ages.get(d) ?? null,
    }),
    fetched_at: market.fetched_at,
  };
}
