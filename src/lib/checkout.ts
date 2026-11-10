import "server-only";
import type { CheckResult } from "@/lib/check/types";
import { db } from "@/lib/db";
import { appOrigin } from "@/lib/fetchPage";
import { PayPalError, paypalRequest } from "@/lib/paypal/client";
import { registryBySlug, shopCredentials, type RegistryEntry } from "@/lib/shopRegistry";
import { formatPrice, getShop } from "@/lib/shops";

// PayPal checkout for shops that passed a Tier 1 check. Orders are created and captured
// server-side with the shop's own sandbox credentials (Orders v2); the browser only ever
// sees the order ID and the shop's public client ID.

export const PASSING_SCORE = 70;

export type CheckoutEligibility =
  | { eligible: true; entry: RegistryEntry; clientId: string; amount: string; currency: "USD"; label: string }
  | { eligible: false; reason: string };

export function checkoutEligibility(result: CheckResult): CheckoutEligibility {
  if (result.tier !== 1 || !result.tier1) return { eligible: false, reason: "PayPal checkout is only offered for shops verified by PayPal payments." };
  if (result.tier1.score.score < PASSING_SCORE) {
    return { eligible: false, reason: `PayPal checkout is offered when the PayPal score is ${PASSING_SCORE} or higher.` };
  }
  const entry = result.identification?.registry_slug ? registryBySlug(result.identification.registry_slug) : undefined;
  const creds = entry && shopCredentials(entry);
  const shop = entry && getShop(entry.slug);
  if (!entry || !creds || !shop) return { eligible: false, reason: "This shop isn't set up for PayPal checkout." };
  return { eligible: true, entry, clientId: creds.clientId, amount: shop.product.price.toFixed(2), currency: "USD", label: formatPrice(shop.product.price) };
}

// --- Order records ------------------------------------------------------------------------

export interface OrderRow {
  id: string;
  check_id: string;
  shop_slug: string;
  amount: string;
  currency: string;
  status: string;
  capture_id: string | null;
  capture_status: string | null;
  payer_name: string | null;
  payer_email: string | null;
  created_at: string;
  captured_at: string | null;
}

function ordersTable() {
  const d = db();
  d.exec(`CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, check_id TEXT NOT NULL, shop_slug TEXT NOT NULL, amount TEXT NOT NULL, currency TEXT NOT NULL,
    status TEXT NOT NULL, capture_id TEXT, capture_status TEXT, payer_name TEXT, payer_email TEXT,
    created_at TEXT NOT NULL, captured_at TEXT
  )`);
  return d;
}

export function getOrder(id: string): OrderRow | undefined {
  return ordersTable().prepare(`SELECT * FROM orders WHERE id = ?`).get(id) as OrderRow | undefined;
}

// --- Orders v2 ----------------------------------------------------------------------------

interface PayPalOrder {
  id: string;
  status: string;
  payer?: { name?: { given_name?: string; surname?: string }; email_address?: string };
  purchase_units?: { payments?: { captures?: { id: string; status: string; amount?: { value: string; currency_code: string } }[] } }[];
}

export async function createCheckoutOrder(checkId: string, result: CheckResult): Promise<{ orderId: string }> {
  const elig = checkoutEligibility(result);
  if (!elig.eligible) throw new Error(elig.reason);
  const shop = getShop(elig.entry.slug)!;
  const creds = shopCredentials(elig.entry)!;
  const value = elig.amount; // price comes from the server, never from the browser

  const order = await paypalRequest<PayPalOrder>(creds, "/v2/checkout/orders", {
    method: "POST",
    prefer: "return=representation",
    body: {
      intent: "CAPTURE",
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: shop.name,
            shipping_preference: "NO_SHIPPING", // fictional demo shop: nothing ships
            user_action: "PAY_NOW",
            return_url: `${appOrigin()}/check/${checkId}`,
            cancel_url: `${appOrigin()}/check/${checkId}`,
          },
        },
      },
      purchase_units: [
        {
          reference_id: shop.slug,
          description: `${shop.product.name} (Vouch sandbox demo)`,
          invoice_id: `VOUCH-CHK-${checkId}-${Date.now().toString(36)}`,
          amount: { currency_code: "USD", value, breakdown: { item_total: { currency_code: "USD", value } } },
          items: [{ name: shop.product.name, quantity: "1", unit_amount: { currency_code: "USD", value }, category: "PHYSICAL_GOODS" }],
        },
      ],
    },
  });

  ordersTable()
    .prepare(`INSERT INTO orders (id, check_id, shop_slug, amount, currency, status, created_at) VALUES (?, ?, ?, ?, 'USD', ?, ?)`)
    .run(order.id, checkId, shop.slug, value, order.status, new Date().toISOString());
  console.info(`[checkout] created ${order.id} for ${shop.slug} ${value} USD (check ${checkId})`);
  return { orderId: order.id };
}

export type CaptureOutcome = { ok: true; order: OrderRow } | { ok: false; error: string; issue?: string; status: number };

export async function captureCheckoutOrder(orderId: string, checkId: string): Promise<CaptureOutcome> {
  const row = getOrder(orderId);
  if (!row || row.check_id !== checkId) return { ok: false, error: "Order not found", status: 404 };
  if (row.capture_id) return { ok: true, order: row }; // already captured (idempotent)

  const entry = registryBySlug(row.shop_slug);
  const creds = entry && shopCredentials(entry);
  if (!creds) return { ok: false, error: "Shop is not configured", status: 500 };

  try {
    const order = await paypalRequest<PayPalOrder>(creds, `/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      prefer: "return=representation",
      requestId: `vouch-capture-${orderId}`,
      body: {},
      retries: 1,
    });
    const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
    const name = [order.payer?.name?.given_name, order.payer?.name?.surname].filter(Boolean).join(" ") || null;
    ordersTable()
      .prepare(
        `UPDATE orders SET status = ?, capture_id = ?, capture_status = ?, payer_name = ?, payer_email = ?, captured_at = ? WHERE id = ?`,
      )
      .run(order.status, capture?.id ?? null, capture?.status ?? null, name, order.payer?.email_address ?? null, new Date().toISOString(), orderId);
    console.info(`[checkout] captured ${orderId}: ${order.status} capture=${capture?.id} ${capture?.status}`);
    return { ok: true, order: getOrder(orderId)! };
  } catch (err) {
    if (err instanceof PayPalError) {
      console.warn(`[checkout] capture ${orderId} failed: ${err.issue} debug_id=${err.debugId}`);
      const declined = err.issue === "INSTRUMENT_DECLINED";
      return {
        ok: false,
        issue: err.issue,
        status: err.status === 422 ? 422 : 502,
        error: declined ? "That payment method was declined. Please choose another one in PayPal." : "PayPal couldn't complete the payment. Please try again.",
      };
    }
    throw err;
  }
}
