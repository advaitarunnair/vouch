import Link from "next/link";
import { notFound } from "next/navigation";
import { VouchWordmark } from "@/components/VouchLogo";
import { getOrder } from "@/lib/checkout";
import { paypalRequest } from "@/lib/paypal/client";
import { registryBySlug, shopCredentials } from "@/lib/shopRegistry";
import { formatPrice, getShop } from "@/lib/shops";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payment complete | Vouch" };

/** This page is reachable by link, so show only a hint of the payer's email. */
function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [user, domain] = email.split("@");
  return domain ? `${user.slice(0, 2)}•••@${domain}` : null;
}

interface LiveOrder {
  status: string;
  update_time?: string;
}

export default async function SuccessPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const order = getOrder(orderId);
  if (!order) notFound();
  const shop = getShop(order.shop_slug);
  const entry = registryBySlug(order.shop_slug);
  const creds = entry && shopCredentials(entry);

  // Confirm the status with PayPal rather than trusting our own record alone.
  let live: LiveOrder | null = null;
  if (creds) {
    live = await paypalRequest<LiveOrder>(creds, `/v2/checkout/orders/${orderId}`).catch(() => null);
  }
  const status = live?.status ?? order.status;
  const completed = status === "COMPLETED";

  const rows: [string, string | null][] = [
    ["Shop", shop?.name ?? order.shop_slug],
    ["Item", shop?.product.name ?? null],
    ["Amount", formatPrice(Number(order.amount), order.currency)],
    ["Paid by", [order.payer_name, maskEmail(order.payer_email)].filter(Boolean).join(" · ") || null],
    ["PayPal order ID", order.id],
    ["Capture ID", order.capture_id],
    ["Status (from PayPal)", status],
    ["Date", order.captured_at ? new Date(order.captured_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null],
  ];

  return (
    <div className="mx-auto max-w-md px-4 py-4">
      <Link href="/">
        <VouchWordmark />
      </Link>
      <section className={`mt-8 rounded-2xl bg-white p-6 ring-2 ${completed ? "ring-emerald-300" : "ring-amber-300"}`}>
        <div className={`grid h-12 w-12 place-items-center rounded-full ${completed ? "bg-emerald-500" : "bg-amber-500"} text-2xl text-white`}>
          {completed ? "✓" : "…"}
        </div>
        <h1 className="mt-4 text-2xl font-bold">{completed ? "Payment complete" : "Payment processing"}</h1>
        <p className="mt-1 text-slate-600">
          {completed
            ? `You paid ${shop?.name ?? "the shop"} with PayPal, a shop Vouch checked against its PayPal payment history.`
            : "PayPal is still processing this payment."}
        </p>
        <dl className="mt-5 divide-y divide-slate-200 text-sm">
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 py-2">
                <dt className="text-slate-500">{k}</dt>
                <dd className="break-all text-right font-medium">{v}</dd>
              </div>
            ))}
        </dl>
        <p className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
          PayPal sandbox payment: no real money moved and nothing will ship. Fictional demo shop.
        </p>
        <div className="mt-5 flex gap-3">
          <Link href={`/check/${order.check_id}`} className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-center font-medium">
            Back to the check
          </Link>
          <Link href="/" className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-center font-medium text-white">
            Check another shop
          </Link>
        </div>
      </section>
    </div>
  );
}
