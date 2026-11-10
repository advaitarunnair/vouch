// Pure helpers that turn PayPal API responses into scoring features.
// Kept free of I/O so they can be unit-tested with recorded responses.

import type { PayPalFeatures } from "@/lib/score/tier1";

export const MAX_WINDOW_DAYS = 31; // Transaction Search limit per request
const DAY = 86_400_000;

export interface TxnInfo {
  transaction_id: string;
  transaction_event_code?: string;
  transaction_status?: string; // D denied, P pending, S success, V reversed
  transaction_amount?: { value: string; currency_code: string };
  transaction_initiation_date?: string;
  custom_field?: string;
  paypal_reference_id?: string;
}
export interface TxnDetail {
  transaction_info: TxnInfo;
  payer_info?: { account_id?: string; email_address?: string };
}

export interface DisputeInfo {
  dispute_id: string;
  create_time?: string;
  status?: string;
  reason?: string;
  dispute_life_cycle_stage?: string;
  dispute_outcome?: { outcome_code?: string };
  disputed_transactions?: { seller_transaction_id?: string; buyer_transaction_id?: string }[];
}

/** Outcomes where the seller ended up liable. */
export const LOST_OUTCOMES = new Set(["RESOLVED_BUYER_FAVOUR", "ACCEPTED"]);

/** Splits [start, end) into consecutive windows no longer than maxDays (newest first). */
export function splitWindows(start: Date, end: Date, maxDays = MAX_WINDOW_DAYS): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  let hi = end.getTime();
  const lo = start.getTime();
  while (hi > lo) {
    const from = Math.max(lo, hi - maxDays * DAY);
    out.push({ start: new Date(from), end: new Date(hi) });
    hi = from;
  }
  return out;
}

/** Transaction Search wants RFC 3339 with seconds and no milliseconds. */
export const toPayPalDate = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const amount = (t: TxnInfo) => Number(t.transaction_amount?.value ?? 0);
const code = (t: TxnInfo) => t.transaction_event_code ?? "";

/** An incoming sale: a positive T00xx "payment received" event that wasn't denied. */
export function isSale(t: TxnInfo): boolean {
  return /^T00\d\d$/.test(code(t)) && amount(t) > 0 && t.transaction_status !== "D";
}

/** A refund the merchant issued (T1107), pending or completed. */
export function isRefund(t: TxnInfo): boolean {
  return code(t) === "T1107" && t.transaction_status !== "D";
}

export function buyerKey(d: TxnDetail): string | null {
  return d.transaction_info.custom_field || d.payer_info?.account_id || d.payer_info?.email_address || null;
}

export interface FeatureSources {
  transactionsScanned: number;
  salesFound: number;
  refundsFound: number;
  disputesFound: number;
  eventCodes: Record<string, number>;
}

export function computeFeatures(
  rows: TxnDetail[],
  disputes: DisputeInfo[],
  opts: { now: Date; windowDays: number; firstPaymentAt: string | null },
): { features: PayPalFeatures; sources: FeatureSources } {
  const windowStart = opts.now.getTime() - opts.windowDays * DAY;
  const inWindow = (iso?: string) => !!iso && Date.parse(iso) >= windowStart && Date.parse(iso) <= opts.now.getTime();

  const eventCodes: Record<string, number> = {};
  for (const r of rows) eventCodes[code(r.transaction_info) || "?"] = (eventCodes[code(r.transaction_info) || "?"] ?? 0) + 1;

  const sales = rows.filter((r) => isSale(r.transaction_info) && inWindow(r.transaction_info.transaction_initiation_date));
  const saleIds = new Set(sales.map((s) => s.transaction_info.transaction_id));

  // Refunds point at the original sale through paypal_reference_id.
  const refunds = rows.filter((r) => isRefund(r.transaction_info) && inWindow(r.transaction_info.transaction_initiation_date));
  const refundedIds = new Set(
    refunds.map((r) => r.transaction_info.paypal_reference_id).filter((id): id is string => !!id && saleIds.has(id)),
  );

  const windowDisputes = disputes.filter((d) => inWindow(d.create_time));
  const disputedIds = new Set(
    windowDisputes.flatMap((d) => (d.disputed_transactions ?? []).map((t) => t.seller_transaction_id)).filter((id): id is string => !!id),
  );
  const problemIds = new Set([...refundedIds, ...[...disputedIds].filter((id) => saleIds.has(id))]);
  // Disputes we couldn't tie to a sale in the window still count once each.
  const unmatchedDisputes = windowDisputes.filter(
    (d) => !(d.disputed_transactions ?? []).some((t) => t.seller_transaction_id && saleIds.has(t.seller_transaction_id)),
  ).length;

  const perBuyer = new Map<string, number>();
  for (const s of sales) {
    const k = buyerKey(s);
    if (k) perBuyer.set(k, (perBuyer.get(k) ?? 0) + 1);
  }

  const first = opts.firstPaymentAt ?? sales.map((s) => s.transaction_info.transaction_initiation_date!).sort()[0] ?? null;
  const tradingDays = first ? Math.max(0, Math.floor((opts.now.getTime() - Date.parse(first)) / DAY)) : 0;

  const features: PayPalFeatures = {
    windowDays: opts.windowDays,
    payments: sales.length,
    refundedPayments: refundedIds.size,
    disputes: windowDisputes.length,
    disputesLost: windowDisputes.filter((d) => LOST_OUTCOMES.has(d.dispute_outcome?.outcome_code ?? "")).length,
    problemOrders: Math.min(sales.length, problemIds.size + unmatchedDisputes),
    distinctBuyers: perBuyer.size,
    repeatBuyers: [...perBuyer.values()].filter((n) => n >= 2).length,
    firstPaymentAt: first,
    tradingDays,
  };
  return {
    features,
    sources: {
      transactionsScanned: rows.length,
      salesFound: sales.length,
      refundsFound: refunds.length,
      disputesFound: windowDisputes.length,
      eventCodes,
    },
  };
}
