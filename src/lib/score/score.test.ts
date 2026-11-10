import { describe, expect, it } from "vitest";
import { betaPosterior, hashSeed, mulberry32, quantile, sampleBeta, sampleGamma, sigmoid } from "./math";
import { FAILURE_PRIOR_MEAN, computeTier1, labelFor, type PayPalFeatures } from "./tier1";

const features = (over: Partial<PayPalFeatures> = {}): PayPalFeatures => ({
  windowDays: 30,
  payments: 40,
  refundedPayments: 2,
  disputes: 0,
  disputesLost: 0,
  problemOrders: 2,
  distinctBuyers: 24,
  repeatBuyers: 12,
  firstPaymentAt: "2026-11-10T00:00:00Z",
  tradingDays: 0,
  ...over,
});

// Profiles matching the seeded sandbox shops.
const AURORA = features();
const GLOWBOX = features({ payments: 25, refundedPayments: 4, problemOrders: 4, distinctBuyers: 21, repeatBuyers: 4 });
const FLASHDEAL = features({ payments: 24, refundedPayments: 8, disputes: 3, disputesLost: 3, problemOrders: 11, distinctBuyers: 24, repeatBuyers: 0 });

describe("math", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(hashSeed("aurora")).toBe(hashSeed("aurora"));
    expect(hashSeed("aurora")).not.toBe(hashSeed("glowbox"));
  });

  it.each([
    [2, 5],
    [0.5, 0.5],
    [5, 45],
    [30, 10],
  ])("Beta(%f, %f) samples have the right mean and variance", (a, b) => {
    const rand = mulberry32(7);
    const n = 40_000;
    const xs = Array.from({ length: n }, () => sampleBeta(a, b, rand));
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
    expect(mean).toBeCloseTo(a / (a + b), 2);
    expect(variance).toBeCloseTo((a * b) / ((a + b) ** 2 * (a + b + 1)), 2);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1);
  });

  it("Gamma samples have mean = shape", () => {
    const rand = mulberry32(3);
    for (const shape of [0.3, 1, 4.5]) {
      const n = 30_000;
      const mean = Array.from({ length: n }, () => sampleGamma(shape, rand)).reduce((s, x) => s + x, 0) / n;
      expect(mean).toBeCloseTo(shape, 1);
    }
    expect(() => sampleGamma(0, rand)).toThrow();
  });

  it("betaPosterior returns the prior with no data and follows the data with lots of it", () => {
    expect(betaPosterior(0, 0, 0.15, 20).mean).toBeCloseTo(0.15, 10);
    const p = betaPosterior(2, 40, 0.15, 20);
    expect(p.alpha).toBeCloseTo(5, 10); // 0.15*20 + 2
    expect(p.beta).toBeCloseTo(55, 10); // 0.85*20 + 38
    expect(p.mean).toBeCloseTo(5 / 60, 10);
    expect(betaPosterior(500, 10_000, 0.15, 20).mean).toBeCloseTo(0.05, 2);
    // successes are clamped to [0, trials]
    expect(betaPosterior(50, 10, 0.15, 20).mean).toBeCloseTo((3 + 10) / 30, 10);
  });

  it("quantile and sigmoid behave", () => {
    expect(quantile([3, 1, 2, 4, 5], 0.5)).toBe(3);
    expect(quantile([0, 10], 0.25)).toBe(2.5);
    expect(Number.isNaN(quantile([], 0.5))).toBe(true);
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(10)).toBeGreaterThan(0.9999);
  });
});

describe("Tier 1 score", () => {
  it("returns null without PayPal sales (Tier 2 applies)", () => {
    expect(computeTier1(features({ payments: 0, distinctBuyers: 0, repeatBuyers: 0, problemOrders: 0, refundedPayments: 0 }))).toBeNull();
  });

  it("ranks the seeded shops trusted > mixed > high risk", () => {
    const a = computeTier1(AURORA)!;
    const g = computeTier1(GLOWBOX)!;
    const f = computeTier1(FLASHDEAL)!;
    expect(a.label).toBe("Trusted");
    expect(g.label).toBe("Use caution");
    expect(f.label).toBe("High risk");
    expect(a.score).toBeGreaterThan(g.score);
    expect(g.score).toBeGreaterThan(f.score);
  });

  it("gives a 90% range that contains the score and is reproducible", () => {
    for (const shop of [AURORA, GLOWBOX, FLASHDEAL]) {
      const s = computeTier1(shop, "shop")!;
      expect(s.range[0]).toBeLessThanOrEqual(s.score);
      expect(s.range[1]).toBeGreaterThanOrEqual(s.score);
      expect(computeTier1(shop, "shop")!.range).toEqual(s.range);
      expect(s.model.draws).toBe(5000);
    }
  });

  it("narrows the range as evidence grows at the same rates", () => {
    const small = computeTier1(features({ payments: 10, problemOrders: 2, refundedPayments: 2, distinctBuyers: 8, repeatBuyers: 2 }))!;
    const big = computeTier1(features({ payments: 1000, problemOrders: 200, refundedPayments: 200, distinctBuyers: 800, repeatBuyers: 200 }))!;
    expect(big.range[1] - big.range[0]).toBeLessThan(small.range[1] - small.range[0]);
  });

  it("smooths low volume towards the neutral prior instead of over-judging", () => {
    const oneBadOrder = computeTier1(features({ payments: 1, problemOrders: 1, refundedPayments: 1, distinctBuyers: 1, repeatBuyers: 0 }))!;
    const manyBadOrders = computeTier1(features({ payments: 100, problemOrders: 100, refundedPayments: 100, distinctBuyers: 100, repeatBuyers: 0 }))!;
    expect(oneBadOrder.model.failureRate.smoothed).toBeCloseTo((FAILURE_PRIOR_MEAN * 20 + 1) / 21, 10);
    expect(oneBadOrder.score).toBeGreaterThan(manyBadOrders.score + 20);
  });

  it("is monotonic in problem orders, repeat buyers and lost disputes", () => {
    const base = computeTier1(GLOWBOX)!.score;
    expect(computeTier1({ ...GLOWBOX, problemOrders: 8, refundedPayments: 8 })!.score).toBeLessThan(base);
    expect(computeTier1({ ...GLOWBOX, repeatBuyers: 12 })!.score).toBeGreaterThan(base);
    expect(computeTier1({ ...GLOWBOX, disputes: 2, disputesLost: 2, problemOrders: 6 })!.score).toBeLessThan(base);
  });

  it("explains the score with the top 3 reasons, ranked by impact", () => {
    const a = computeTier1(AURORA)!;
    expect(a.reasons).toHaveLength(3);
    const impacts = a.reasons.map((r) => Math.abs(r.impact));
    expect([...impacts].sort((x, y) => y - x)).toEqual(impacts);
    expect(a.reasons.map((r) => r.text).join(" ")).toContain("50% of buyers came back to buy again");

    const f = computeTier1(FLASHDEAL)!;
    expect(f.reasons.every((r) => r.direction !== "positive")).toBe(true);
    expect(f.reasons.map((r) => r.key)).toContain("refunds");
  });

  it("labels by threshold", () => {
    expect(labelFor(75)).toBe("Trusted");
    expect(labelFor(74)).toBe("Use caution");
    expect(labelFor(50)).toBe("Use caution");
    expect(labelFor(49)).toBe("High risk");
  });
});
