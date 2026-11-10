// Tier 1: "Verified by PayPal payments". Pure scoring maths over features computed
// from PayPal Transaction Search and Disputes API responses (see paypal/history.ts).

import { betaPosterior, hashSeed, mulberry32, quantile, sampleBeta, sigmoid } from "./math";

export interface PayPalFeatures {
  windowDays: number;
  /** Completed incoming payments (sales) in the window. */
  payments: number;
  /** Payments that were refunded (fully or partly). */
  refundedPayments: number;
  /** Buyer disputes opened in the window. */
  disputes: number;
  /** Disputes resolved against the seller (buyer won, or seller accepted the claim). */
  disputesLost: number;
  /** Orders with a refund or a dispute (each order counted once). */
  problemOrders: number;
  distinctBuyers: number;
  /** Buyers with two or more payments in the window. */
  repeatBuyers: number;
  /** ISO date of the earliest PayPal sale found. */
  firstPaymentAt: string | null;
  /** Days between the first sale and now. */
  tradingDays: number;
}

export type TrustLabel = "Trusted" | "Use caution" | "High risk";

export interface Reason {
  key: "repeat" | "refunds" | "disputes" | "lost" | "volume" | "history";
  text: string;
  direction: "positive" | "negative" | "neutral";
  /** Contribution to the logit relative to a typical shop (for ranking). */
  impact: number;
}

export interface Tier1Score {
  tier: 1;
  score: number;
  range: [number, number];
  label: TrustLabel;
  summary: string;
  reasons: Reason[];
  model: {
    failureRate: { observed: number; smoothed: number; alpha: number; beta: number };
    repeatRate: { observed: number; smoothed: number; alpha: number; beta: number };
    lostRate: number;
    logit: number;
    draws: number;
  };
}

// --- Model constants (documented in the README) ------------------------------------------
export const FAILURE_PRIOR_MEAN = 0.15; // neutral prior: an unknown shop has ~15% problem orders
export const FAILURE_PRIOR_STRENGTH = 20; // worth 20 orders, so low-volume shops aren't over-judged
export const REPEAT_PRIOR_MEAN = 0.2;
export const REPEAT_PRIOR_STRENGTH = 10;
export const BASELINE = { failureRate: 0.1, repeatRate: 0.2 }; // "typical shop" reference point
export const WEIGHTS = { intercept: 1.2, failure: -10, repeat: 3, lost: -8, volume: 0.4, history: 0.3 };
export const MONTE_CARLO_DRAWS = 5000;

export function labelFor(score: number): TrustLabel {
  if (score >= 75) return "Trusted";
  if (score >= 50) return "Use caution";
  return "High risk";
}

const lostRateOf = (f: PayPalFeatures) => f.disputesLost / (f.payments + 5);
const volumeTerm = (f: PayPalFeatures) => WEIGHTS.volume * Math.log(1 + f.payments / 20);
const historyTerm = (f: PayPalFeatures) => WEIGHTS.history * Math.min(1, f.tradingDays / 365);

export function logit(failureRate: number, repeatRate: number, f: PayPalFeatures): number {
  return (
    WEIGHTS.intercept +
    WEIGHTS.failure * (failureRate - BASELINE.failureRate) +
    WEIGHTS.repeat * (repeatRate - BASELINE.repeatRate) +
    WEIGHTS.lost * lostRateOf(f) +
    volumeTerm(f) +
    historyTerm(f)
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function computeTier1(f: PayPalFeatures, seedKey = "vouch"): Tier1Score | null {
  if (f.payments <= 0) return null; // no PayPal sales: Tier 2 applies

  const fail = betaPosterior(f.problemOrders, f.payments, FAILURE_PRIOR_MEAN, FAILURE_PRIOR_STRENGTH);
  const rep = betaPosterior(f.repeatBuyers, f.distinctBuyers, REPEAT_PRIOR_MEAN, REPEAT_PRIOR_STRENGTH);
  const z = logit(fail.mean, rep.mean, f);
  const score = Math.round(100 * sigmoid(z));

  // Monte Carlo over the Beta posteriors for a 90% range.
  const rand = mulberry32(hashSeed(`${seedKey}:${f.payments}:${f.problemOrders}:${f.repeatBuyers}:${f.disputesLost}`));
  const draws: number[] = new Array(MONTE_CARLO_DRAWS);
  for (let i = 0; i < MONTE_CARLO_DRAWS; i++) {
    const pf = sampleBeta(fail.alpha, fail.beta, rand);
    const pr = sampleBeta(rep.alpha, rep.beta, rand);
    draws[i] = 100 * sigmoid(logit(pf, pr, f));
  }
  const range: [number, number] = [Math.round(quantile(draws, 0.05)), Math.round(quantile(draws, 0.95))];

  const label = labelFor(score);
  const reasons = buildReasons(f, fail.mean, rep.mean);
  return {
    tier: 1,
    score,
    range,
    label,
    summary: summaryFor(label, f),
    reasons: reasons.slice(0, 3),
    model: {
      failureRate: { observed: f.problemOrders / f.payments, smoothed: fail.mean, alpha: fail.alpha, beta: fail.beta },
      repeatRate: {
        observed: f.distinctBuyers ? f.repeatBuyers / f.distinctBuyers : 0,
        smoothed: rep.mean,
        alpha: rep.alpha,
        beta: rep.beta,
      },
      lostRate: lostRateOf(f),
      logit: z,
      draws: MONTE_CARLO_DRAWS,
    },
  };
}

function summaryFor(label: TrustLabel, f: PayPalFeatures): string {
  const base = `Based on ${plural(f.payments, "PayPal payment")} in the last ${f.windowDays} days.`;
  if (label === "Trusted") return `Real buyers keep coming back and few orders go wrong. ${base}`;
  if (label === "Use caution") return `Mostly fine, but more orders than usual end in refunds or disputes. ${base}`;
  return `Many orders end in refunds or disputes. ${base}`;
}

/** Plain-English reasons, ranked by how much each feature moves the score versus a typical shop. */
export function buildReasons(f: PayPalFeatures, smoothedFailure: number, smoothedRepeat: number): Reason[] {
  const reasons: Reason[] = [];
  const failureImpact = WEIGHTS.failure * (smoothedFailure - BASELINE.failureRate);
  const refundShare = f.problemOrders ? Math.min(1, f.refundedPayments / f.problemOrders) : 0.5;
  const refundRate = f.refundedPayments / f.payments;
  const disputeRate = f.disputes / f.payments;

  // Repeat buyers
  const repeatObserved = f.distinctBuyers ? f.repeatBuyers / f.distinctBuyers : 0;
  reasons.push({
    key: "repeat",
    text:
      f.repeatBuyers > 0
        ? `${pct(repeatObserved)} of buyers came back to buy again (typical: ${pct(BASELINE.repeatRate)}).`
        : `None of the ${plural(f.distinctBuyers, "buyer")} came back to buy again (typical: ${pct(BASELINE.repeatRate)}).`,
    direction: smoothedRepeat >= BASELINE.repeatRate ? "positive" : "negative",
    impact: WEIGHTS.repeat * (smoothedRepeat - BASELINE.repeatRate),
  });

  // Refunds
  reasons.push({
    key: "refunds",
    text:
      f.refundedPayments === 0
        ? `No refunds on ${plural(f.payments, "payment")}.`
        : `${pct(refundRate)} of payments were refunded (${f.refundedPayments} of ${f.payments}).`,
    direction: refundRate <= BASELINE.failureRate ? "positive" : "negative",
    impact: failureImpact * refundShare,
  });

  // Disputes opened
  reasons.push({
    key: "disputes",
    text:
      f.disputes === 0
        ? `No buyer disputes in the last ${f.windowDays} days.`
        : `${plural(f.disputes, "buyer")} opened a dispute (${pct(disputeRate)} of payments).`,
    direction: f.disputes === 0 ? "positive" : "negative",
    impact: f.disputes === 0 ? 0.05 : failureImpact * (1 - refundShare),
  });

  // Disputes lost
  if (f.disputesLost > 0) {
    reasons.push({
      key: "lost",
      text: `${plural(f.disputesLost, "dispute")} ended in the buyer's favour.`,
      direction: "negative",
      impact: WEIGHTS.lost * lostRateOf(f),
    });
  }

  // Volume
  reasons.push({
    key: "volume",
    text: `${plural(f.payments, "completed PayPal payment")} from ${plural(f.distinctBuyers, "buyer")} in the last ${f.windowDays} days.`,
    direction: f.payments >= 20 ? "positive" : "neutral",
    impact: volumeTerm(f) - WEIGHTS.volume * Math.log(2), // versus a 20-order shop
  });

  // Trading history
  reasons.push({
    key: "history",
    text:
      f.tradingDays < 30
        ? `PayPal sales history is short: the first sale was ${f.tradingDays <= 1 ? "in the last day" : `${f.tradingDays} days ago`}.`
        : `Has been taking PayPal payments for ${f.tradingDays >= 365 ? "over a year" : `${f.tradingDays} days`}.`,
    direction: f.tradingDays >= 180 ? "positive" : f.tradingDays < 30 ? "negative" : "neutral",
    impact: historyTerm(f) - WEIGHTS.history * 0.5, // versus six months of history
  });

  return reasons.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
}
