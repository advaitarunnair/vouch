// Tier 2: "No PayPal history: public signals only". A lower-confidence score from
// domain age (RDAP), HTTPS, Claude's page scan (verified quotes) and the Channel3 price check.

import type { PageScan, Severity } from "@/lib/pageScanTypes";
import { POSITIVE_LABELS, RISK_LABELS } from "@/lib/pageScanTypes";
import type { PriceVerdict } from "@/lib/priceCheck";
import { hashSeed, mulberry32, quantile, sigmoid } from "./math";

export interface PublicSignals {
  /** null when unknown (lookup failed, or a page hosted by Vouch). */
  domainAgeDays: number | null;
  domain: string | null;
  /** null when not applicable (local demo pages). */
  https: boolean | null;
  scan: PageScan | null;
  priceVerdict: PriceVerdict | null;
  priceText: string | null;
}

export type Tier2Label = "Likely OK (unverified)" | "Unverified" | "High risk";

export interface Tier2Reason {
  key: string;
  text: string;
  direction: "positive" | "negative" | "neutral";
  impact: number;
  evidence?: string[];
  source: string;
}

export interface Tier2Score {
  tier: 2;
  score: number;
  range: [number, number];
  label: Tier2Label;
  summary: string;
  reasons: Tier2Reason[];
  signalsUsed: number;
  model: { logit: number; draws: number };
}

export const TIER2 = {
  intercept: 0.2,
  severity: { high: -1.2, medium: -0.6, low: -0.2 } as Record<Severity, number>,
  riskCap: -3,
  positiveEach: 0.35,
  positiveCap: 1.0,
  noHttps: -1.2,
  https: 0.1,
  price: { far_below: -1.5, below: 0, typical: 0.2, above: 0, unknown: 0 } as Record<PriceVerdict, number>,
  maxScore: 85, // without payment history a shop can't look "verified"
  draws: 2000,
  weightNoise: 0.35, // relative uncertainty of each weight
  modelNoise: 0.6, // extra logit noise for what public signals can't see
};

export function domainAgeTerm(days: number | null): number {
  if (days === null) return 0;
  if (days < 30) return -2.0;
  if (days < 180) return -1.2;
  if (days < 365) return -0.6;
  if (days < 3 * 365) return 0;
  if (days < 10 * 365) return 0.5;
  return 0.8;
}

export function labelForTier2(score: number): Tier2Label {
  if (score >= 70) return "Likely OK (unverified)";
  if (score >= 45) return "Unverified";
  return "High risk";
}

const SOURCE = { rdap: "Domain registry (RDAP)", page: "Page scan by Claude", price: "Channel3 price comparison", https: "Connection check" };

function ageText(days: number, domain: string | null): string {
  const d = domain ?? "The domain";
  if (days < 30) return `${d} was registered only ${days} days ago.`;
  if (days < 365) return `${d} was registered ${Math.round(days / 30)} months ago.`;
  const years = Math.floor(days / 365);
  return `${d} has been registered for ${years} year${years === 1 ? "" : "s"}.`;
}

/** Each signal as a logit term with a plain-English reason. */
export function tier2Terms(s: PublicSignals): Tier2Reason[] {
  const terms: Tier2Reason[] = [];

  if (s.domainAgeDays !== null) {
    const t = domainAgeTerm(s.domainAgeDays);
    terms.push({ key: "domain_age", text: ageText(s.domainAgeDays, s.domain), direction: t > 0 ? "positive" : t < 0 ? "negative" : "neutral", impact: t, source: SOURCE.rdap });
  }
  if (s.https !== null) {
    terms.push(
      s.https
        ? { key: "https", text: "The page uses a secure (HTTPS) connection.", direction: "positive", impact: TIER2.https, source: SOURCE.https }
        : { key: "https", text: "The page doesn't use a secure (HTTPS) connection.", direction: "negative", impact: TIER2.noHttps, source: SOURCE.https },
    );
  }

  if (s.scan) {
    // Risks: summed, then scaled so the total never exceeds the cap.
    const raw = s.scan.risks.map((r) => TIER2.severity[r.severity]);
    const total = raw.reduce((a, b) => a + b, 0);
    const scale = total < TIER2.riskCap ? TIER2.riskCap / total : 1;
    s.scan.risks.forEach((r, i) =>
      terms.push({
        key: `risk:${r.type}:${i}`,
        text: `${RISK_LABELS[r.type] ?? "Concern"}: ${r.explanation}`,
        direction: "negative",
        impact: raw[i] * scale,
        evidence: r.evidence,
        source: SOURCE.page,
      }),
    );
    const pos = s.scan.positives.slice(0, Math.round(TIER2.positiveCap / TIER2.positiveEach));
    pos.forEach((p, i) =>
      terms.push({
        key: `positive:${p.type}:${i}`,
        text: `${POSITIVE_LABELS[p.type] ?? "Good sign"}: ${p.explanation}`,
        direction: "positive",
        impact: Math.min(TIER2.positiveEach, TIER2.positiveCap - i * TIER2.positiveEach),
        evidence: p.evidence,
        source: SOURCE.page,
      }),
    );
  }

  if (s.priceVerdict && s.priceVerdict !== "unknown" && s.priceText) {
    const t = TIER2.price[s.priceVerdict];
    terms.push({ key: "price", text: s.priceText, direction: t > 0 ? "positive" : t < 0 ? "negative" : "neutral", impact: t, source: SOURCE.price });
  }
  return terms;
}

export function computeTier2(s: PublicSignals, seedKey = "vouch"): Tier2Score {
  const terms = tier2Terms(s);
  const z = TIER2.intercept + terms.reduce((a, t) => a + t.impact, 0);
  const cap = (x: number) => Math.min(TIER2.maxScore, x);
  const score = Math.round(cap(100 * sigmoid(z)));

  // Wider range than Tier 1: every weight is uncertain, plus noise for what public signals can't see.
  const rand = mulberry32(hashSeed(`${seedKey}:t2:${terms.map((t) => t.key).join(",")}`));
  const gauss = () => {
    let u = 0;
    while (u === 0) u = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const draws: number[] = [];
  for (let i = 0; i < TIER2.draws; i++) {
    let zi = TIER2.intercept + gauss() * TIER2.modelNoise;
    for (const t of terms) zi += t.impact * (1 + gauss() * TIER2.weightNoise);
    draws.push(cap(100 * sigmoid(zi)));
  }
  const range: [number, number] = [Math.round(quantile(draws, 0.05)), Math.round(quantile(draws, 0.95))];
  const label = labelForTier2(score);
  const signalsUsed = (s.domainAgeDays !== null ? 1 : 0) + (s.https !== null ? 1 : 0) + (s.scan ? 1 : 0) + (s.priceVerdict && s.priceVerdict !== "unknown" ? 1 : 0);

  return {
    tier: 2,
    score,
    range,
    label,
    summary:
      label === "High risk"
        ? "This shop shows several warning signs, and there's no PayPal payment history to check it against."
        : label === "Unverified"
          ? "Mixed public signals and no PayPal payment history, so we can't verify this shop."
          : "Public signals look reasonable, but without PayPal payment history this isn't verified.",
    reasons: [...terms].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 3),
    signalsUsed,
    model: { logit: z, draws: TIER2.draws },
  };
}
