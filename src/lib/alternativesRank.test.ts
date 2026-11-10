import { describe, expect, it } from "vitest";
import { rankAlternatives, retailerTrust } from "./alternativesRank";
import type { MarketOffer } from "./priceCheck";

const offer = (product_id: string, domain: string, price: number): MarketOffer => ({
  product_id,
  title: `Item ${product_id}`,
  brand: null,
  image: null,
  domain,
  price,
  currency: "USD",
  url: `https://${domain}/${product_id}`,
});

const ages: Record<string, number | null> = {
  "old.example": 20 * 365,
  "mid.example": 2 * 365,
  "new.example": 30,
  "other-old.example": 10 * 365,
  "unknown.example": null,
};

describe("retailerTrust", () => {
  it("labels by domain age", () => {
    expect(retailerTrust(10 * 365)).toBe("established");
    expect(retailerTrust(2 * 365)).toBe("unverified");
    expect(retailerTrust(null)).toBe("unverified");
    expect(retailerTrust(10)).toBe("new");
  });
});

describe("rankAlternatives", () => {
  const offers = [
    offer("a", "mid.example", 50),
    offer("b", "old.example", 90),
    offer("c", "new.example", 40),
    offer("d", "other-old.example", 80),
    offer("e", "shop.example", 60), // the shop being checked
    offer("f", "old.example", 5), // suspiciously cheap
    offer("g", "unknown.example", 70),
    offer("b", "other-old.example", 85), // same product, pricier offer
  ];

  it("excludes the checked shop, brand-new sites and suspiciously cheap offers; ranks by trust then price", () => {
    const ranked = rankAlternatives(offers, { median: 80, excludeHost: "www.shop.example", ageDays: (d) => ages[d] ?? null, limit: 10 });
    expect(ranked.map((r) => r.product_id)).toEqual(["d", "b", "a", "g"]);
    expect(ranked[0]).toMatchObject({ trust: "established", domain_age_years: 10 });
    expect(ranked.some((r) => r.domain === "shop.example" || r.domain === "new.example" || r.price < 20)).toBe(false);
  });

  it("lists each product and each retailer at most once, picking the best-ranked offer", () => {
    const ranked = rankAlternatives(offers, { median: null, ageDays: (d) => ages[d] ?? null, limit: 10 });
    expect(new Set(ranked.map((r) => r.product_id)).size).toBe(ranked.length);
    expect(new Set(ranked.map((r) => r.domain)).size).toBe(ranked.length);
    // A product isn't lost just because its cheapest retailer was already used.
    const twoRetailers = rankAlternatives([offer("x", "old.example", 10), offer("y", "old.example", 20), offer("y", "other-old.example", 25)], {
      median: null,
      ageDays: (d) => ages[d] ?? null,
    });
    expect(twoRetailers.map((r) => `${r.product_id}@${r.domain}`)).toEqual(["x@old.example", "y@other-old.example"]);
  });

  it("respects the limit", () => {
    expect(rankAlternatives(offers, { median: 80, ageDays: (d) => ages[d] ?? null, limit: 2 })).toHaveLength(2);
  });
});
