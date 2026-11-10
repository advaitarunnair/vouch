// Pure price-comparison logic (unit-tested). Inputs come from Channel3 search results.

export interface MarketOffer {
  product_id: string;
  title: string;
  brand: string | null;
  image: string | null;
  domain: string;
  price: number;
  currency: string;
  url: string;
}

export type PriceVerdict = "far_below" | "below" | "typical" | "above" | "unknown";

export interface PriceCheck {
  shop_price: number | null;
  currency: string;
  market_median: number | null;
  market_low: number | null;
  market_high: number | null;
  /** shop_price / market_median */
  ratio: number | null;
  verdict: PriceVerdict;
  comparables: number;
  text: string;
}

export const FAR_BELOW_RATIO = 0.25; // under a quarter of the typical price: classic too-good-to-be-true signal
export const BELOW_RATIO = 0.6;
export const ABOVE_RATIO = 1.5;
export const MIN_COMPARABLES = 3;

/** "$12.99", "12,99 €", "USD 1,299.00", "1.299,00 €" → number. Returns null when no number is present. */
export function parsePrice(text: string | number | null | undefined): number | null {
  if (typeof text === "number") return Number.isFinite(text) ? text : null;
  const m = text?.match(/\d[\d.,]*/);
  if (!m) return null;
  let n = m[0].replace(/[.,]$/, "");
  const lastDot = n.lastIndexOf(".");
  const lastComma = n.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // The later separator is the decimal point; the other groups thousands.
    n = lastDot > lastComma ? n.replace(/,/g, "") : n.replace(/\./g, "").replace(",", ".");
  } else if (lastComma >= 0) {
    // "12,99" is a decimal comma; "1,299" groups thousands.
    n = /,\d{1,2}$/.test(n) && n.split(",").length === 2 ? n.replace(",", ".") : n.replace(/,/g, "");
  } else if (n.split(".").length > 2) {
    n = n.replace(/\./g, ""); // "1.299.000"
  }
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: n < 100 ? 2 : 0 }).format(n);

export function comparePrice(shopPrice: number | null, offers: MarketOffer[], currency = "USD"): PriceCheck {
  // One price per product (its cheapest in-stock offer) so one product with many offers doesn't dominate.
  const perProduct = new Map<string, number>();
  for (const o of offers) {
    if (o.currency !== currency) continue;
    const prev = perProduct.get(o.product_id);
    if (prev === undefined || o.price < prev) perProduct.set(o.product_id, o.price);
  }
  const prices = [...perProduct.values()].filter((p) => p > 0);
  const rawMedian = prices.length >= MIN_COMPARABLES ? median(prices) : null;
  const med = rawMedian === null ? null : Math.round(rawMedian * 100) / 100;
  const base = {
    shop_price: shopPrice,
    currency,
    market_median: med,
    market_low: prices.length ? Math.min(...prices) : null,
    market_high: prices.length ? Math.max(...prices) : null,
    comparables: prices.length,
  };

  if (shopPrice === null || med === null) {
    return {
      ...base,
      ratio: null,
      verdict: "unknown",
      text: shopPrice === null ? "We couldn't read this shop's price." : "Not enough similar products to compare prices.",
    };
  }
  const ratio = shopPrice / med;
  const pctOff = Math.round((1 - ratio) * 100);
  const vs = `similar products typically cost ${money(med, currency)} (${prices.length} compared)`;
  if (ratio < FAR_BELOW_RATIO) {
    return { ...base, ratio, verdict: "far_below", text: `${money(shopPrice, currency)} is ${pctOff}% below the usual price: ${vs}. Prices this low are a common warning sign.` };
  }
  if (ratio < BELOW_RATIO) {
    return { ...base, ratio, verdict: "below", text: `${money(shopPrice, currency)} is cheaper than most: ${vs}.` };
  }
  if (ratio > ABOVE_RATIO) {
    return { ...base, ratio, verdict: "above", text: `${money(shopPrice, currency)} is more than most: ${vs}.` };
  }
  return { ...base, ratio, verdict: "typical", text: `${money(shopPrice, currency)} is in the normal range: ${vs}.` };
}
