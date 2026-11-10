import "server-only";
import { claimCheck, getCheck, getUpload, updateCheck, type CheckRow } from "@/lib/db";
import { appOrigin, fetchPage } from "@/lib/fetchPage";
import { CONFIDENCE_THRESHOLD, identifyFromScreenshot, identifyFromUrl } from "@/lib/identify";
import { getPayPalHistory } from "@/lib/paypal/history";
import { computeTier1 } from "@/lib/score/tier1";
import { registryBySlug, shopCredentials } from "@/lib/shopRegistry";
import { suggestedQuestions } from "@/lib/ai/chat";
import { marketQueryFor } from "@/lib/ai/marketQuery";
import { scanPage } from "@/lib/ai/pageScan";
import { domainAge } from "@/lib/rdap";
import { computeTier2 } from "@/lib/score/tier2";
import { channel3Configured, searchMarket } from "@/lib/channel3";
import { comparePrice, parsePrice, type MarketOffer } from "@/lib/priceCheck";
import { emptyResult, type CheckResult, type CheckView, type StepKey } from "./types";

// Runs a check's steps in order, saving progress after each one so the result
// page can show live status. Later phases add the PayPal, page-scan and price steps.

export function readResult(row: CheckRow): CheckResult {
  return row.result_json ? (JSON.parse(row.result_json) as CheckResult) : emptyResult();
}

export function toView(row: CheckRow): CheckView {
  return {
    id: row.id,
    status: row.status,
    source: row.source,
    input_url: row.input_url,
    has_screenshot: row.source === "screenshot",
    created_at: row.created_at,
    updated_at: row.updated_at,
    result: readResult(row),
    suggested_questions: row.status === "done" ? suggestedQuestions(readResult(row)) : [],
  };
}

async function step<T>(id: string, result: CheckResult, key: StepKey, fn: () => Promise<T>): Promise<T> {
  result.steps[key] = { status: "running" };
  updateCheck(id, { result });
  const started = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - started;
    result.steps[key] = { ...result.steps[key], status: result.steps[key].status === "running" ? "done" : result.steps[key].status, ms };
    console.info(`[check ${id}] ${key} ${ms}ms`);
    return out;
  } catch (err) {
    result.steps[key] = { status: "error", ms: Date.now() - started, note: err instanceof Error ? err.message : String(err) };
    console.error(`[check ${id}] ${key} failed`, err);
    throw err;
  } finally {
    updateCheck(id, { result });
  }
}

export async function runCheck(id: string): Promise<void> {
  if (!claimCheck(id)) return; // already running or finished
  const row = getCheck(id)!;
  const result = readResult(row);

  try {
    // 1. Identify the shop (skipped when the user already confirmed it).
    if (!result.identification || result.steps.identify.status !== "done") {
      await step(id, result, "identify", async () => {
        if (row.source === "screenshot") {
          const upload = getUpload(id);
          if (!upload) throw new Error("The screenshot upload is missing");
          result.identification = await identifyFromScreenshot(upload);
        } else {
          const { identification, page } = await identifyFromUrl(row.input_url!);
          result.identification = identification;
          // Keep the page text when the user submitted a shop page (not for social-style links).
          if (page && identification.page_url && page.finalUrl === identification.page_url) {
            result.page = {
              url: page.finalUrl,
              https: page.https,
              status: page.status,
              title: page.meta.title,
              description: page.meta.description,
              text: page.text,
              fetched_at: new Date().toISOString(),
            };
          }
        }
        const idn = result.identification!;
        result.steps.identify.note = idn.shop_name
          ? `${idn.shop_name}${idn.confidence < 1 ? ` (${Math.round(idn.confidence * 100)}% sure)` : ""}`
          : "Shop not identified";
      });

      if (!result.identification?.shop_name || result.identification.confidence < CONFIDENCE_THRESHOLD) {
        updateCheck(id, { status: "needs_confirmation", result });
        return;
      }
    }

    // Fetch the shop page if we are allowed to and haven't yet (hosted pages, submitted links, confirmed shops).
    const pageUrl = result.identification!.page_url;
    if (pageUrl && !result.page) {
      try {
        const page = await fetchPage(pageUrl, appOrigin());
        result.page = {
          url: page.finalUrl,
          https: page.https,
          status: page.status,
          title: page.meta.title,
          description: page.meta.description,
          text: page.text,
          fetched_at: new Date().toISOString(),
        };
      } catch (err) {
        console.warn(`[check ${id}] page fetch failed`, err);
      }
    }

    // 2. PayPal payment history (Tier 1) for shops in the PayPal registry.
    const entry = result.identification?.registry_slug ? registryBySlug(result.identification.registry_slug) : undefined;
    if (entry && shopCredentials(entry)) {
      await step(id, result, "paypal", async () => {
        const history = await getPayPalHistory(entry);
        const score = history ? computeTier1(history.features, entry.slug) : null;
        if (history && score) {
          result.tier = 1;
          result.tier1 = { score, features: history.features, sources: history.sources, fetched_at: history.fetched_at };
          result.steps.paypal.note = `${history.features.payments} payments, ${history.features.disputes} disputes in ${history.features.windowDays} days`;
        } else {
          result.tier = 2;
          result.steps.paypal.note = "No PayPal sales found in the last 30 days";
        }
      }).catch(() => {
        // PayPal unavailable: fall back to public signals rather than failing the whole check.
        result.tier = 2;
      });
    } else {
      result.tier = 2;
      result.steps.paypal = { status: "skipped", note: "No PayPal history for this shop: public signals only" };
    }

    // 3. Shop page scan (Claude, verified quotes) plus domain age (RDAP) and HTTPS.
    {
      const idn0 = result.identification!;
      const pageUrl = result.page?.url ?? idn0.page_url;
      const hosted = !!pageUrl && new URL(pageUrl).origin === new URL(appOrigin()).origin;
      const host = hosted ? null : (idn0.shop_domain ?? (pageUrl ? new URL(pageUrl).hostname : null));
      if (result.page || host) {
        await step(id, result, "page", async () => {
          const [scanRes, age] = await Promise.all([
            result.page ? scanPage({ url: result.page.url, title: result.page.title, text: result.page.text }) : Promise.resolve(null),
            host && !idn0.registry_slug ? domainAge(host) : Promise.resolve(null),
          ]);
          result.signals = {
            hosted,
            https: hosted || !result.page ? null : result.page.https,
            domain: age,
            scan: scanRes?.scan ?? null,
            scan_error: scanRes?.error,
          };
          const risks = scanRes?.scan?.risks.length ?? 0;
          const notes = [
            scanRes?.scan ? `${risks} warning sign${risks === 1 ? "" : "s"}, ${scanRes.scan.positives.length} good sign${scanRes.scan.positives.length === 1 ? "" : "s"}` : scanRes ? "Page scan unavailable" : "No page to scan",
            age?.age_days != null ? `domain ${Math.floor(age.age_days / 365)}y old` : null,
          ].filter(Boolean);
          result.steps.page.note = notes.join(", ");
        }).catch(() => {});
      } else {
        result.steps.page = { status: "skipped", note: "No shop page to scan" };
      }
    }

    // 4. Price check against the wider market (Channel3). Informational for Tier 1, a signal for Tier 2.
    const idn = result.identification!;
    const product = idn.product ?? result.page?.title ?? null;
    if (product && channel3Configured()) {
      await step(id, result, "price", async () => {
        const { query } = await marketQueryFor({
          product,
          title: result.page?.title,
          description: result.page?.description,
          pageText: result.page?.text,
        });
        const market = await searchMarket(query);
        const shopHost = idn.shop_domain?.replace(/^www\./, "");
        const check = comparePrice(parsePrice(idn.price), market.offers);
        result.price = {
          query,
          check,
          // Kept for "safer alternatives": in-stock offers from other merchants, one per product.
          alternatives: dedupeByProduct(market.offers.filter((o) => !shopHost || !o.domain.endsWith(shopHost))).slice(0, 8),
          fetched_at: market.fetched_at,
        };
        result.steps.price.note =
          check.market_median !== null ? `Typical price ${check.market_median.toFixed(2)} ${check.currency} (${check.comparables} compared)` : check.text;
      }).catch(() => {
        // Price data is optional: keep going without it.
      });
    } else {
      result.steps.price = { status: "skipped", note: product ? "Price comparison unavailable" : "No product to compare" };
    }

    // Tier 2: no usable PayPal history, so score from public signals only.
    if (result.tier !== 1) {
      result.tier = 2;
      result.tier2 = computeTier2(
        {
          domainAgeDays: result.signals?.domain?.age_days ?? null,
          domain: result.signals?.domain?.domain ?? null,
          https: result.signals?.https ?? null,
          scan: result.signals?.scan ?? null,
          priceVerdict: result.price?.check.verdict ?? null,
          priceText: result.price?.check.text ?? null,
        },
        result.identification?.shop_domain ?? id,
      );
    }
    updateCheck(id, { status: "done", result });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    updateCheck(id, { status: "error", result });
  }
}

function dedupeByProduct(offers: MarketOffer[]): MarketOffer[] {
  const best = new Map<string, MarketOffer>();
  for (const o of offers) {
    const prev = best.get(o.product_id);
    if (!prev || o.price < prev.price) best.set(o.product_id, o);
  }
  return [...best.values()];
}
