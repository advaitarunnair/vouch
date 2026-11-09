/**
 * Seeds REAL PayPal sandbox payment history for Vouch's three fictional shops.
 *
 *   npm run seed                                  # card orders + refunds for all shops (resumable)
 *   npm run seed -- seed --shop aurora            # one shop
 *   npm run seed -- seed --dry-run                # print the plan, call nothing
 *   npm run seed -- seed --shop glowbox --fresh   # forget saved state and seed a NEW batch
 *   npm run seed -- wallet --shop flashdeal --count 4   # PayPal-wallet orders for manual approval (disputes)
 *   npm run seed -- capture-wallet --shop flashdeal     # capture the wallet orders you approved
 *   npm run seed -- disputes --shop flashdeal [--settle BUYER_FAVOR|SELLER_FAVOR]
 *   npm run seed -- summary                       # what Transaction Search + Disputes return right now
 *
 * APIs (sandbox only), checked against PayPal's OpenAPI specs:
 *   POST /v2/checkout/orders                      Orders v2, intent CAPTURE, payment_source.card (sandbox test card)
 *   POST /v2/checkout/orders/{id}/capture         Orders v2 (only if the order was not completed on create)
 *   POST /v2/payments/captures/{id}/refund        Payments v2, full refund (empty body)
 *   GET  /v1/reporting/transactions               Transaction Search (31-day max range, page_size <= 500)
 *   GET  /v1/customer/disputes, POST .../escalate, POST .../adjudicate (sandbox-only settle)
 *
 * Each order's purchase_units[0].custom_id is a stable synthetic buyer id ("buyer-aur-007"),
 * which Transaction Search returns as transaction_info.custom_field. That is how Vouch
 * computes distinct buyers and repeat-buyer rate.
 */
import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PayPalError, paypalRequest, type PayPalCredentials } from "../src/lib/paypal/client";
import { SHOP_REGISTRY, registryByKey, shopCredentials, type RegistryEntry, type ShopKey } from "../src/lib/shopRegistry";
import { getShop } from "../src/lib/shops";

loadEnv({ path: ".env.local" });
loadEnv();

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

interface SeedProfile {
  orders: number;
  distinctBuyers: number; // orders - distinctBuyers = repeat purchases
  repeatPool: number; // repeat purchases are spread across the first N buyers
  refunds: number;
  quantities: number[]; // picked deterministically per order
}

const PROFILES: Record<ShopKey, SeedProfile> = {
  aurora: { orders: 40, distinctBuyers: 24, repeatPool: 12, refunds: 2, quantities: [1, 1, 1, 2] },
  glowbox: { orders: 25, distinctBuyers: 21, repeatPool: 4, refunds: 4, quantities: [1, 1, 1, 1, 2] },
  flashdeal: { orders: 20, distinctBuyers: 20, repeatPool: 0, refunds: 8, quantities: [1, 1, 2, 3] },
};

// PayPal sandbox test card (https://developer.paypal.com/tools/sandbox/card-testing/)
const TEST_CARD = {
  number: "4012888888881881",
  expiry: "2030-12",
  security_code: "123",
  billing_address: {
    address_line_1: "100 Demo Street",
    admin_area_2: "San Jose",
    admin_area_1: "CA",
    postal_code: "95131",
    country_code: "US",
  },
};

interface PlannedOrder {
  n: number;
  buyer: string;
  quantity: number;
  value: string;
  refund: boolean;
}

/** Small deterministic PRNG so the plan is identical on every run. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildPlan(entry: RegistryEntry): PlannedOrder[] {
  const p = PROFILES[entry.key];
  const shop = getShop(entry.slug)!;
  const rnd = mulberry32(entry.key.split("").reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const tag = entry.key.slice(0, 3);
  const id = (i: number) => `buyer-${tag}-${String(i + 1).padStart(3, "0")}`;

  const buyers: string[] = [];
  for (let i = 0; i < p.distinctBuyers; i++) buyers.push(id(i));
  for (let i = 0; i < p.orders - p.distinctBuyers; i++) buyers.push(id(i % Math.max(1, p.repeatPool)));

  // Shuffle so repeat purchases are interleaved, but keep each buyer's first order before their repeats.
  for (let i = buyers.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [buyers[i], buyers[j]] = [buyers[j], buyers[i]];
  }

  // Spread refunds evenly through the batch.
  const refundAt = new Set<number>();
  for (let k = 0; k < p.refunds; k++) refundAt.add(Math.floor(((k + 0.5) * p.orders) / p.refunds));

  return buyers.map((buyer, n) => {
    const quantity = p.quantities[Math.floor(rnd() * p.quantities.length)];
    return { n, buyer, quantity, value: (shop.product.price * quantity).toFixed(2), refund: refundAt.has(n) };
  });
}

// ---------------------------------------------------------------------------
// Local state (resumable, gitignored)
// ---------------------------------------------------------------------------

interface OrderState extends PlannedOrder {
  orderId?: string;
  captureId?: string;
  captureStatus?: string;
  refundId?: string;
  refundStatus?: string;
  error?: string;
}
interface WalletOrder {
  orderId: string;
  buyer: string;
  value: string;
  approveUrl: string;
  captureId?: string;
  captureStatus?: string;
}
interface State {
  shops: Partial<Record<ShopKey, { batch: string; orders: OrderState[] }>>;
  wallet: Partial<Record<ShopKey, WalletOrder[]>>;
}

const STATE_PATH = path.join(process.cwd(), "scripts", ".seed-state.json");
const loadState = (): State =>
  existsSync(STATE_PATH) ? (JSON.parse(readFileSync(STATE_PATH, "utf8")) as State) : { shops: {}, wallet: {} };
const saveState = (s: State) => writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith("--") ? args[0] : "seed";
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function selectedShops(): RegistryEntry[] {
  const s = opt("shop");
  if (!s || s === "all") return SHOP_REGISTRY;
  const e = registryByKey(s);
  if (!e) throw new Error(`Unknown --shop "${s}". Use aurora, glowbox, flashdeal or all.`);
  return [e];
}

function credsOrExit(entry: RegistryEntry): PayPalCredentials {
  const c = shopCredentials(entry);
  if (!c) {
    console.error(`✗ Missing ${entry.envPrefix}_CLIENT_ID / ${entry.envPrefix}_CLIENT_SECRET in .env.local`);
    process.exit(1);
  }
  return c;
}

function explain(err: unknown): string {
  if (err instanceof PayPalError) {
    const details = JSON.stringify((err.body as { details?: unknown })?.details ?? err.body);
    return `${err.message}${err.issue ? ` [${err.issue}]` : ""} debug_id=${err.debugId ?? "?"} ${details}`;
  }
  return err instanceof Error ? err.message : String(err);
}

const CARD_SETUP_HINT = `
  Card payments look disabled for this sandbox app. In the PayPal Developer Dashboard:
    Apps & Credentials → (Sandbox) → your app → Features → enable "Advanced Credit and Debit Card Payments".
  Or seed by hand with PayPal-wallet orders:  npm run seed -- wallet --shop <shop> --count <n>
  (see docs/SANDBOX_SETUP.md).`;

interface OrderResponse {
  id: string;
  status: string;
  purchase_units?: { payments?: { captures?: { id: string; status: string }[] } }[];
  links?: { href: string; rel: string }[];
}

const firstCapture = (o: OrderResponse) => o.purchase_units?.[0]?.payments?.captures?.[0];

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function seed() {
  const dry = flag("dry-run");
  const state = loadState();

  for (const entry of selectedShops()) {
    const shop = getShop(entry.slug)!;
    const plan = buildPlan(entry);
    const buyers = new Set(plan.map((o) => o.buyer)).size;
    console.log(
      `\n▶ ${shop.name}: ${plan.length} orders, ${buyers} distinct buyers, ${plan.filter((o) => o.refund).length} refunds`,
    );
    if (dry) {
      for (const o of plan) console.log(`  #${o.n} ${o.buyer} x${o.quantity} $${o.value}${o.refund ? "  → refund" : ""}`);
      continue;
    }

    const creds = credsOrExit(entry);
    if (flag("fresh") || !state.shops[entry.key]) {
      state.shops[entry.key] = { batch: Date.now().toString(36), orders: plan.map((o) => ({ ...o })) };
      saveState(state);
    }
    const shopState = state.shops[entry.key]!;

    for (const o of shopState.orders) {
      const label = `  #${String(o.n).padStart(2)} ${o.buyer} $${o.value}`;
      try {
        if (!o.captureId) {
          const created = await paypalRequest<OrderResponse>(creds, "/v2/checkout/orders", {
            method: "POST",
            prefer: "return=representation",
            requestId: `vouch-${entry.key}-${shopState.batch}-${o.n}-create`,
            body: {
              intent: "CAPTURE",
              payment_source: { card: { name: `Demo ${o.buyer}`, ...TEST_CARD } },
              purchase_units: [
                {
                  reference_id: `${entry.slug}-${o.n}`,
                  description: `${shop.product.name} x${o.quantity}`,
                  custom_id: o.buyer,
                  invoice_id: `VOUCH-${entry.key.toUpperCase()}-${shopState.batch}-${o.n}`,
                  amount: { currency_code: "USD", value: o.value },
                },
              ],
            },
          });
          o.orderId = created.id;
          let capture = firstCapture(created);
          if (!capture && (created.status === "APPROVED" || created.status === "CREATED")) {
            const captured = await paypalRequest<OrderResponse>(creds, `/v2/checkout/orders/${created.id}/capture`, {
              method: "POST",
              prefer: "return=representation",
              requestId: `vouch-${entry.key}-${shopState.batch}-${o.n}-capture`,
              body: {},
            });
            capture = firstCapture(captured);
          }
          if (!capture) throw new Error(`Order ${created.id} has status ${created.status} and no capture`);
          o.captureId = capture.id;
          o.captureStatus = capture.status;
          delete o.error;
          saveState(state);
        }

        if (o.refund && !o.refundId && o.captureStatus === "COMPLETED") {
          const refund = await paypalRequest<{ id: string; status: string }>(
            creds,
            `/v2/payments/captures/${o.captureId}/refund`,
            {
              method: "POST",
              prefer: "return=representation",
              requestId: `vouch-${entry.key}-${shopState.batch}-${o.n}-refund`,
              body: { note_to_payer: `Refund from ${shop.name} (Vouch sandbox demo)` },
            },
          );
          o.refundId = refund.id;
          o.refundStatus = refund.status;
          saveState(state);
        }
        console.log(`${label} ✓ capture ${o.captureId} ${o.captureStatus}${o.refundId ? `, refund ${o.refundStatus}` : ""}`);
      } catch (err) {
        o.error = explain(err);
        saveState(state);
        console.error(`${label} ✗ ${o.error}`);
        const issue = err instanceof PayPalError ? `${err.issue ?? ""} ${JSON.stringify(err.body)}` : "";
        if (/CARD|NOT_ENABLED|PAYEE_NOT|UNPROCESSABLE|NOT_AUTHORIZED|PERMISSION/i.test(issue)) {
          console.error(CARD_SETUP_HINT);
          break;
        }
      }
      await sleep(250);
    }

    const done = shopState.orders.filter((o) => o.captureId).length;
    const refunded = shopState.orders.filter((o) => o.refundId).length;
    console.log(`  → ${done}/${shopState.orders.length} captured, ${refunded} refunded (batch ${shopState.batch})`);
  }

  if (!dry) {
    console.log(
      "\nDone. Transaction Search can take up to 3 hours to show new transactions. Check with:  npm run seed -- summary",
    );
  }
}

async function wallet() {
  const entry = selectedShops()[0];
  if (!opt("shop")) throw new Error("wallet needs --shop");
  const count = Number(opt("count") ?? "3");
  const creds = credsOrExit(entry);
  const shop = getShop(entry.slug)!;
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  const state = loadState();
  const list = (state.wallet[entry.key] ??= []);

  console.log(`\nCreating ${count} PayPal-wallet orders for ${shop.name}. Approve each link as your sandbox BUYER:`);
  for (let i = 0; i < count; i++) {
    const buyer = `buyer-${entry.key.slice(0, 3)}-w${String(list.length + 1).padStart(2, "0")}`;
    const value = shop.product.price.toFixed(2);
    const order = await paypalRequest<OrderResponse>(creds, "/v2/checkout/orders", {
      method: "POST",
      prefer: "return=representation",
      body: {
        intent: "CAPTURE",
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: shop.name,
              user_action: "PAY_NOW",
              shipping_preference: "NO_SHIPPING",
              return_url: `${appUrl}/shops/${entry.slug}?approved=1`,
              cancel_url: `${appUrl}/shops/${entry.slug}?cancelled=1`,
            },
          },
        },
        purchase_units: [
          {
            reference_id: `${entry.slug}-w${list.length}`,
            description: shop.product.name,
            custom_id: buyer,
            invoice_id: `VOUCH-${entry.key.toUpperCase()}-W-${Date.now().toString(36)}-${i}`,
            amount: { currency_code: "USD", value },
          },
        ],
      },
    });
    const approveUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? "";
    list.push({ orderId: order.id, buyer, value, approveUrl });
    saveState(state);
    console.log(`  ${order.id}  ${approveUrl}`);
  }
  console.log(`\nAfter approving, run:  npm run seed -- capture-wallet --shop ${entry.key}`);
}

async function captureWallet() {
  const entry = selectedShops()[0];
  if (!opt("shop")) throw new Error("capture-wallet needs --shop");
  const creds = credsOrExit(entry);
  const state = loadState();
  for (const w of state.wallet[entry.key] ?? []) {
    if (w.captureId) {
      console.log(`  ${w.orderId} already captured (${w.captureId})`);
      continue;
    }
    try {
      const o = await paypalRequest<OrderResponse>(creds, `/v2/checkout/orders/${w.orderId}/capture`, {
        method: "POST",
        prefer: "return=representation",
        requestId: `vouch-wallet-${w.orderId}-capture`,
        body: {},
      });
      const c = firstCapture(o);
      w.captureId = c?.id;
      w.captureStatus = c?.status;
      saveState(state);
      console.log(`  ${w.orderId} ✓ capture ${w.captureId} ${w.captureStatus}`);
    } catch (err) {
      console.error(`  ${w.orderId} ✗ ${explain(err)}`);
    }
  }
}

interface DisputeSummary {
  dispute_id: string;
  status: string;
  reason?: string;
  dispute_life_cycle_stage?: string;
  dispute_amount?: { value: string; currency_code: string };
  links?: { href: string; rel: string }[];
}
interface DisputeDetail extends DisputeSummary {
  dispute_outcome?: { outcome_code?: string };
}

async function listDisputes(creds: PayPalCredentials): Promise<DisputeSummary[]> {
  const items: DisputeSummary[] = [];
  let next: string | undefined;
  const after = new Date(Date.now() - 179 * 86400_000).toISOString();
  for (let guard = 0; guard < 50; guard++) {
    const res = await paypalRequest<{ items?: DisputeSummary[]; links?: { href: string; rel: string }[] }>(
      creds,
      "/v1/customer/disputes",
      { query: next ? { next_page_token: next, page_size: 50 } : { create_time_after: after, page_size: 50 } },
    );
    items.push(...(res.items ?? []));
    const nextLink = res.links?.find((l) => l.rel === "next")?.href;
    next = nextLink ? (new URL(nextLink).searchParams.get("next_page_token") ?? undefined) : undefined;
    if (!next) break;
  }
  return items;
}

async function disputes() {
  const settle = opt("settle") as "BUYER_FAVOR" | "SELLER_FAVOR" | undefined;
  if (settle && settle !== "BUYER_FAVOR" && settle !== "SELLER_FAVOR") throw new Error("--settle must be BUYER_FAVOR or SELLER_FAVOR");
  for (const entry of selectedShops()) {
    const creds = credsOrExit(entry);
    const list = await listDisputes(creds);
    console.log(`\n▶ ${entry.slug}: ${list.length} dispute(s)`);
    for (const d of list) {
      let detail = await paypalRequest<DisputeDetail>(creds, `/v1/customer/disputes/${d.dispute_id}`);
      console.log(
        `  ${d.dispute_id} ${detail.status} ${detail.dispute_life_cycle_stage ?? ""} ${detail.reason ?? ""} outcome=${detail.dispute_outcome?.outcome_code ?? "-"}`,
      );
      if (!settle || detail.status === "RESOLVED") continue;
      const has = (rel: string) => detail.links?.some((l) => l.rel === rel);
      if (has("escalate")) {
        await paypalRequest(creds, `/v1/customer/disputes/${d.dispute_id}/escalate`, {
          method: "POST",
          body: { note: "Escalated by the Vouch sandbox seed script for demo data." },
        });
        console.log("    ↳ escalated to claim");
        detail = await paypalRequest<DisputeDetail>(creds, `/v1/customer/disputes/${d.dispute_id}`);
      }
      if (has("adjudicate") || detail.links?.some((l) => l.rel === "adjudicate")) {
        await paypalRequest(creds, `/v1/customer/disputes/${d.dispute_id}/adjudicate`, {
          method: "POST",
          body: { adjudication_outcome: settle },
        });
        console.log(`    ↳ adjudicated ${settle}`);
      } else {
        console.log(`    ↳ not ready to adjudicate yet (status ${detail.status}); try again later`);
      }
    }
  }
}

interface TxnDetail {
  transaction_info: {
    transaction_id: string;
    transaction_event_code?: string;
    transaction_status?: string;
    transaction_amount?: { value: string; currency_code: string };
    custom_field?: string;
    transaction_initiation_date?: string;
  };
}

async function summary() {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 86400_000);
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
  for (const entry of selectedShops()) {
    const creds = shopCredentials(entry);
    if (!creds) {
      console.log(`\n▶ ${entry.slug}: no credentials configured`);
      continue;
    }
    try {
      const rows: TxnDetail[] = [];
      let page = 1;
      let totalPages = 1;
      do {
        const res = await paypalRequest<{ transaction_details?: TxnDetail[]; total_pages?: number }>(
          creds,
          "/v1/reporting/transactions",
          { query: { start_date: iso(start), end_date: iso(end), fields: "transaction_info", page_size: 500, page } },
        );
        rows.push(...(res.transaction_details ?? []));
        totalPages = res.total_pages ?? 1;
        page++;
      } while (page <= totalPages);

      const payments = rows.filter((r) => Number(r.transaction_info.transaction_amount?.value ?? 0) > 0);
      const negatives = rows.filter((r) => Number(r.transaction_info.transaction_amount?.value ?? 0) < 0);
      const buyers = new Set(payments.map((r) => r.transaction_info.custom_field).filter(Boolean));
      const codes = [...new Set(rows.map((r) => r.transaction_info.transaction_event_code))].join(", ");
      const dl = await listDisputes(creds);
      console.log(
        `\n▶ ${entry.slug}: ${rows.length} transactions (event codes: ${codes || "-"})\n` +
          `  ${payments.length} incoming, ${negatives.length} outgoing (refunds/fees), ${buyers.size} distinct custom_field buyers, ${dl.length} disputes`,
      );
    } catch (err) {
      console.error(`\n▶ ${entry.slug}: ✗ ${explain(err)}`);
    }
  }
}

const COMMANDS: Record<string, () => Promise<void>> = {
  seed,
  wallet,
  "capture-wallet": captureWallet,
  disputes,
  summary,
};

const run = COMMANDS[command];
if (!run) {
  console.error(`Unknown command "${command}". Use: ${Object.keys(COMMANDS).join(", ")}`);
  process.exit(1);
}
run().catch((err) => {
  console.error(`✗ ${explain(err)}`);
  process.exit(1);
});
