import { describe, expect, it } from "vitest";
import { domainCandidates, registrationDate, serverFromBootstrap } from "@/lib/rdap";
import { quoteInText, verifyFindings, type PageScan } from "@/lib/pageScanTypes";
import { TIER2, computeTier2, domainAgeTerm, labelForTier2, tier2Terms, type PublicSignals } from "./tier2";

const risky: PageScan = {
  summary: "",
  positives: [],
  risks: [
    { type: "fake_countdown", severity: "high", explanation: "A timer pushes you to buy now.", evidence: ["ENDS IN 00:09:59"], verified: true },
    { type: "extreme_discount", severity: "high", explanation: "90% off.", evidence: ["90% OFF"], verified: true },
    { type: "missing_contact", severity: "high", explanation: "No contact details.", evidence: [], verified: true },
    { type: "vague_returns", severity: "medium", explanation: "Returns depend on eligibility.", evidence: ["Contact us for return eligibility"], verified: true },
  ],
};
const clean: PageScan = {
  summary: "",
  risks: [],
  positives: [
    { type: "contact_details", severity: "low", explanation: "Email, phone and address.", evidence: ["hello@shop.example"], verified: true },
    { type: "clear_returns", severity: "low", explanation: "30-day returns.", evidence: ["30-day returns"], verified: true },
    { type: "business_identity", severity: "low", explanation: "Founded 2019.", evidence: ["founded in 2019"], verified: true },
    { type: "transparent_pricing", severity: "low", explanation: "Clear price.", evidence: ["$48"], verified: true },
  ],
};
const signals = (over: Partial<PublicSignals> = {}): PublicSignals => ({
  domainAgeDays: 2000,
  domain: "shop.example",
  https: true,
  scan: clean,
  priceVerdict: "typical",
  priceText: "$48 is in the normal range.",
  ...over,
});

describe("RDAP helpers", () => {
  it("reads the registration event", () => {
    expect(registrationDate({ events: [{ eventAction: "expiration", eventDate: "2030-01-01" }, { eventAction: "registration", eventDate: "1995-08-14T04:00:00Z" }] })).toBe("1995-08-14T04:00:00Z");
    expect(registrationDate({})).toBeNull();
  });
  it("finds a TLD's RDAP server in the IANA bootstrap list, preferring https", () => {
    const services: [string[], string[]][] = [
      [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
      [["uk"], ["http://insecure.example/", "https://rdap.nominet.uk/uk/"]],
    ];
    expect(serverFromBootstrap(services, "com")).toBe("https://rdap.verisign.com/com/v1/");
    expect(serverFromBootstrap(services, "UK")).toBe("https://rdap.nominet.uk/uk/");
    expect(serverFromBootstrap(services, "zz")).toBeNull();
  });
  it("tries parent domains for subdomains", () => {
    expect(domainCandidates("www.Shop.Example.co.uk")).toEqual(["shop.example.co.uk", "example.co.uk", "co.uk"]);
    expect(domainCandidates("example.com")).toEqual(["example.com"]);
  });
});

describe("page scan evidence verification", () => {
  const page = "FLASHDEAL OUTLET\n🔥 90% OFF — ENDS IN 00:09:59\nContact us for return eligibility.  Some items are final sale.";

  it("matches quotes regardless of case, whitespace and dash/quote style", () => {
    expect(quoteInText("90% off - ends in 00:09:59", page)).toBe(true);
    expect(quoteInText("“Contact us for return eligibility.”", page)).toBe(true);
    expect(quoteInText("Free shipping worldwide", page)).toBe(false);
    expect(quoteInText("a", page)).toBe(false);
  });

  it("drops invented quotes, lowers unsupported risks and removes unsupported positives", () => {
    const out = verifyFindings(
      {
        summary: "s",
        risks: [
          { type: "extreme_discount", severity: "high", explanation: "e", evidence: ["90% OFF", "made-up quote"] },
          { type: "pressure_tactics", severity: "high", explanation: "e", evidence: ["Only 1 left!!"] },
          { type: "missing_contact", severity: "high", explanation: "e", evidence: [] },
        ],
        positives: [{ type: "clear_returns", severity: "low", explanation: "e", evidence: ["30-day free returns"] }],
      },
      page,
    );
    expect(out.risks[0]).toMatchObject({ evidence: ["90% OFF"], severity: "high", verified: true });
    expect(out.risks[1]).toMatchObject({ evidence: [], severity: "medium", verified: false });
    expect(out.risks[2]).toMatchObject({ severity: "high", verified: true });
    expect(out.positives).toHaveLength(0);
  });
});

describe("Tier 2 score", () => {
  it("maps domain age to a logit term", () => {
    expect(domainAgeTerm(null)).toBe(0);
    expect(domainAgeTerm(5)).toBeLessThan(domainAgeTerm(200));
    expect(domainAgeTerm(200)).toBeLessThan(domainAgeTerm(5000));
  });

  it("separates a clean, established shop from a risky new one", () => {
    const good = computeTier2(signals());
    const bad = computeTier2(signals({ domainAgeDays: 12, https: false, scan: risky, priceVerdict: "far_below", priceText: "94% below the usual price." }));
    expect(good.label).toBe("Likely OK (unverified)");
    expect(bad.label).toBe("High risk");
    expect(bad.score).toBeLessThan(10);
    expect(bad.reasons.every((r) => r.direction === "negative")).toBe(true);
  });

  it("never reaches the verified range without payment history", () => {
    const best = computeTier2(signals({ domainAgeDays: 20 * 365 }));
    expect(best.score).toBeLessThanOrEqual(TIER2.maxScore);
    expect(best.range[1]).toBeLessThanOrEqual(TIER2.maxScore);
  });

  it("caps the combined page-risk penalty", () => {
    const many: PageScan = { ...risky, risks: [...risky.risks, ...risky.risks, ...risky.risks] };
    const pageTotal = tier2Terms(signals({ scan: many })).filter((t) => t.key.startsWith("risk:")).reduce((a, t) => a + t.impact, 0);
    expect(pageTotal).toBeCloseTo(TIER2.riskCap, 10);
  });

  it("gives a wider range than the point estimate and is reproducible", () => {
    const s = computeTier2(signals({ scan: null, priceVerdict: null, priceText: null }), "x");
    expect(s.range[0]).toBeLessThanOrEqual(s.score);
    expect(s.range[1]).toBeGreaterThanOrEqual(s.score);
    expect(s.range[1] - s.range[0]).toBeGreaterThan(10);
    expect(computeTier2(signals({ scan: null, priceVerdict: null, priceText: null }), "x").range).toEqual(s.range);
    expect(s.signalsUsed).toBe(2);
  });

  it("uses only the allowed labels (never 'scam')", () => {
    for (const n of [0, 44, 45, 69, 70, 85]) expect(labelForTier2(n)).not.toMatch(/scam/i);
    expect(labelForTier2(44)).toBe("High risk");
    expect(labelForTier2(45)).toBe("Unverified");
    expect(labelForTier2(70)).toBe("Likely OK (unverified)");
  });
});
