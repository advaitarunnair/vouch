import "server-only";
import { claimCheck, getCheck, getUpload, updateCheck, type CheckRow } from "@/lib/db";
import { appOrigin, fetchPage } from "@/lib/fetchPage";
import { CONFIDENCE_THRESHOLD, identifyFromScreenshot, identifyFromUrl } from "@/lib/identify";
import { getPayPalHistory } from "@/lib/paypal/history";
import { computeTier1 } from "@/lib/score/tier1";
import { registryBySlug, shopCredentials } from "@/lib/shopRegistry";
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

    // 3-4. Page scan and price check arrive in Phase 6.
    for (const key of ["page", "price"] as const) {
      if (result.steps[key].status === "pending") result.steps[key] = { status: "skipped", note: "Coming in a later phase" };
    }
    updateCheck(id, { status: "done", result });
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
    updateCheck(id, { status: "error", result });
  }
}
