// Small, dependency-free statistics helpers for the trust score.

/** Deterministic PRNG (mulberry32) so a shop's confidence range is stable between refreshes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Standard normal via Box-Muller. */
function normal(rand: () => number): number {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Gamma(shape, 1) sample, Marsaglia & Tsang (2000). */
export function sampleGamma(shape: number, rand: () => number): number {
  if (shape <= 0) throw new Error("shape must be > 0");
  if (shape < 1) {
    // Boost: Gamma(a) = Gamma(a + 1) * U^(1/a)
    return sampleGamma(shape + 1, rand) * Math.pow(rand() || Number.MIN_VALUE, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(alpha, beta) sample from two Gamma draws. */
export function sampleBeta(alpha: number, beta: number, rand: () => number): number {
  const x = sampleGamma(alpha, rand);
  const y = sampleGamma(beta, rand);
  return x / (x + y);
}

export interface BetaPosterior {
  alpha: number;
  beta: number;
  mean: number;
}

/**
 * Beta-Binomial smoothing: start from a prior with mean `priorMean` worth
 * `priorStrength` pseudo-observations, then add `successes` out of `trials`.
 * With few trials the estimate stays near the prior; with many it follows the data.
 */
export function betaPosterior(successes: number, trials: number, priorMean: number, priorStrength: number): BetaPosterior {
  const s = Math.max(0, Math.min(successes, trials));
  const alpha = priorMean * priorStrength + s;
  const beta = (1 - priorMean) * priorStrength + (trials - s);
  return { alpha, beta, mean: alpha / (alpha + beta) };
}

export const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Linear-interpolated quantile of an unsorted array (q in [0, 1]). */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
