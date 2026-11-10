import "server-only";
import { Channel3 } from "@channel3/sdk";
import { cacheGet, cacheSet } from "@/lib/db";
import type { MarketOffer } from "@/lib/priceCheck";

// Channel3 product search (https://docs.trychannel3.com), used for the price check and
// safer alternatives. Server-side only: the API key never reaches the browser.

const CACHE_TTL_MS = 30 * 60 * 1000; // prices change: keep this short (offer URLs are refetched by Phase 7 at display time)

let client: Channel3 | null = null;
const getClient = () => (client ??= new Channel3({ apiKey: process.env.CHANNEL3_API_KEY, maxRetries: 2, timeoutInSeconds: 15 }));

export function channel3Configured(): boolean {
  return Boolean(process.env.CHANNEL3_API_KEY);
}

export interface MarketSearch {
  query: string;
  offers: MarketOffer[];
  products: number;
  fetched_at: string;
  ms: number;
}

/**
 * Searches Channel3 (default lexical + semantic mode, US/USD, new + in stock by default)
 * and flattens results to one row per in-stock merchant offer.
 */
export async function searchMarket(query: string, limit = 20): Promise<MarketSearch> {
  const key = `channel3:search:v1:${query.toLowerCase().trim()}:${limit}`;
  const hit = cacheGet<MarketSearch>(key);
  if (hit) return hit;

  const started = Date.now();
  const page = await getClient().products.search({ query, limit, config: { country: "US", currency: "USD" } });
  const offers: MarketOffer[] = [];
  for (const p of page.data) {
    const image = p.images?.find((i) => i.is_main_image)?.cleaned_url ?? p.images?.[0]?.cleaned_url ?? p.images?.[0]?.url ?? null;
    for (const o of p.offers ?? []) {
      if (o.availability !== "InStock") continue;
      offers.push({
        product_id: p.id,
        title: p.title,
        brand: p.brands?.[0]?.name ?? null,
        image,
        domain: o.domain,
        price: o.price.price,
        currency: o.price.currency,
        url: o.url,
      });
    }
  }
  const result: MarketSearch = { query, offers, products: page.data.length, fetched_at: new Date().toISOString(), ms: Date.now() - started };
  console.info(`[channel3] "${query}": ${page.data.length} products, ${offers.length} offers, ${result.ms}ms`);
  cacheSet(key, result, CACHE_TTL_MS);
  return result;
}
