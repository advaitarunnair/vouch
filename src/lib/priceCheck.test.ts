import { describe, expect, it } from "vitest";
import { comparePrice, median, parsePrice, type MarketOffer } from "./priceCheck";

const offer = (product_id: string, price: number, currency = "USD"): MarketOffer => ({
  product_id,
  title: `Product ${product_id}`,
  brand: null,
  image: null,
  domain: `${product_id}.example`,
  price,
  currency,
  url: `https://${product_id}.example`,
});

describe("parsePrice", () => {
  it.each([
    ["$12.99", 12.99],
    ["12,99 €", 12.99],
    ["USD 1,299.00", 1299],
    ["1.299,00 €", 1299],
    ["$1,299", 1299],
    ["Now only 48!", 48],
    ["£ 69.", 69],
    [48, 48],
  ])("parses %s", (input, expected) => {
    expect(parsePrice(input)).toBeCloseTo(expected, 5);
  });

  it("returns null without a number", () => {
    expect(parsePrice("free")).toBeNull();
    expect(parsePrice(null)).toBeNull();
    expect(parsePrice(undefined)).toBeNull();
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("comparePrice", () => {
  const market = [offer("a", 199.99), offer("b", 229.99), offer("c", 249.95), offer("d", 298), offer("e", 149.99)];

  it("flags a price far below the market median", () => {
    const r = comparePrice(12.99, market);
    expect(r.market_median).toBe(229.99);
    expect(r.verdict).toBe("far_below");
    expect(r.text).toMatch(/94% below the usual price/);
  });

  it("classifies below, typical and above", () => {
    expect(comparePrice(100, market).verdict).toBe("below");
    expect(comparePrice(220, market).verdict).toBe("typical");
    expect(comparePrice(400, market).verdict).toBe("above");
  });

  it("uses each product's cheapest offer once, so one product can't dominate", () => {
    const skewed = [offer("a", 10), offer("a", 11), offer("a", 12), offer("b", 100), offer("c", 110)];
    const r = comparePrice(50, skewed);
    expect(r.comparables).toBe(3);
    expect(r.market_median).toBe(100);
  });

  it("ignores other currencies and needs at least 3 comparables", () => {
    const r = comparePrice(50, [offer("a", 100), offer("b", 120), offer("c", 90, "EUR")]);
    expect(r.comparables).toBe(2);
    expect(r.verdict).toBe("unknown");
    expect(r.market_median).toBeNull();
  });

  it("is unknown when the shop price can't be read", () => {
    expect(comparePrice(null, market).verdict).toBe("unknown");
  });
});
