import "server-only";
import { cacheGet, cacheSet } from "@/lib/db";
import { paypalRequest, type PayPalCredentials } from "@/lib/paypal/client";
import { computeFeatures, isSale, splitWindows, toPayPalDate, type DisputeInfo, type FeatureSources, type TxnDetail } from "@/lib/paypal/features";
import { shopCredentials, type RegistryEntry } from "@/lib/shopRegistry";
import type { PayPalFeatures } from "@/lib/score/tier1";

// Pulls a shop's real PayPal sandbox history:
//  - Transaction Search (GET /v1/reporting/transactions): last 30 days, paginated,
//    plus a look-back in 31-day windows to find the first sale (trading history).
//  - Disputes (GET /v1/customer/disputes + GET /v1/customer/disputes/{id}) for outcomes.
// Results are cached per shop for one hour.

export const WINDOW_DAYS = 30;
const LOOKBACK_WINDOWS = 12; // ~1 year of 31-day windows for the first-sale date
const CACHE_TTL_MS = 60 * 60 * 1000;
const DAY = 86_400_000;

export interface PayPalHistory {
  features: PayPalFeatures;
  sources: FeatureSources & { apiCalls: number; windowsScanned: number };
  fetched_at: string;
}

async function searchWindow(creds: PayPalCredentials, start: Date, end: Date, counter: { calls: number }): Promise<TxnDetail[]> {
  const rows: TxnDetail[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    counter.calls++;
    const res = await paypalRequest<{ transaction_details?: TxnDetail[]; total_pages?: number }>(creds, "/v1/reporting/transactions", {
      query: {
        start_date: toPayPalDate(start),
        end_date: toPayPalDate(end),
        fields: "transaction_info,payer_info",
        // Include pending refunds and holds, not only balance-affecting rows.
        balance_affecting_records_only: "N",
        page_size: 500,
        page,
      },
    });
    rows.push(...(res.transaction_details ?? []));
    totalPages = res.total_pages ?? 1;
    page++;
  } while (page <= totalPages && page <= 50);
  return rows;
}

async function listDisputes(creds: PayPalCredentials, since: Date, counter: { calls: number }): Promise<DisputeInfo[]> {
  const summaries: DisputeInfo[] = [];
  let next: string | undefined;
  for (let guard = 0; guard < 20; guard++) {
    counter.calls++;
    const res = await paypalRequest<{ items?: DisputeInfo[]; links?: { href: string; rel: string }[] }>(creds, "/v1/customer/disputes", {
      query: next ? { next_page_token: next, page_size: 50 } : { create_time_after: since.toISOString(), page_size: 50 },
    });
    summaries.push(...(res.items ?? []));
    const nextLink = res.links?.find((l) => l.rel === "next")?.href;
    next = nextLink ? (new URL(nextLink).searchParams.get("next_page_token") ?? undefined) : undefined;
    if (!next) break;
  }
  // Details carry the outcome and the disputed seller transaction ids.
  const details: DisputeInfo[] = [];
  for (const s of summaries.slice(0, 50)) {
    counter.calls++;
    details.push(await paypalRequest<DisputeInfo>(creds, `/v1/customer/disputes/${s.dispute_id}`));
  }
  return details;
}

async function findFirstSale(creds: PayPalCredentials, now: Date, recent: TxnDetail[], counter: { calls: number }) {
  const earliest = (rows: TxnDetail[]) =>
    rows
      .filter((r) => isSale(r.transaction_info))
      .map((r) => r.transaction_info.transaction_initiation_date!)
      .sort()[0];

  let first = earliest(recent) ?? null;
  let emptyStreak = 0;
  let scanned = 0;
  const older = splitWindows(new Date(now.getTime() - (WINDOW_DAYS + LOOKBACK_WINDOWS * 31) * DAY), new Date(now.getTime() - WINDOW_DAYS * DAY));
  for (const w of older) {
    const rows = await searchWindow(creds, w.start, w.end, counter);
    scanned++;
    const e = earliest(rows);
    if (e) {
      first = e;
      emptyStreak = 0;
    } else if (++emptyStreak >= 2) {
      break; // two quiet months in a row: assume this is where trading started
    }
  }
  return { first, scanned };
}

export async function getPayPalHistory(entry: RegistryEntry, opts: { refresh?: boolean } = {}): Promise<PayPalHistory | null> {
  const creds = shopCredentials(entry);
  if (!creds) return null;
  const cacheKey = `paypal-history:v1:${entry.slug}`;
  if (!opts.refresh) {
    const hit = cacheGet<PayPalHistory>(cacheKey);
    if (hit) return hit;
  }

  const started = Date.now();
  const now = new Date();
  const counter = { calls: 0 };
  const recentWindows = splitWindows(new Date(now.getTime() - WINDOW_DAYS * DAY), now);
  const recent = (await Promise.all(recentWindows.map((w) => searchWindow(creds, w.start, w.end, counter)))).flat();
  const [disputes, firstSale] = await Promise.all([
    listDisputes(creds, new Date(now.getTime() - 179 * DAY), counter),
    findFirstSale(creds, now, recent, counter),
  ]);

  const { features, sources } = computeFeatures(recent, disputes, { now, windowDays: WINDOW_DAYS, firstPaymentAt: firstSale.first });
  const history: PayPalHistory = {
    features,
    sources: { ...sources, apiCalls: counter.calls, windowsScanned: recentWindows.length + firstSale.scanned },
    fetched_at: now.toISOString(),
  };
  console.info(`[paypal] ${entry.slug}: ${counter.calls} API calls, ${sources.transactionsScanned} txns, ${Date.now() - started}ms`);
  cacheSet(cacheKey, history, CACHE_TTL_MS);
  return history;
}
