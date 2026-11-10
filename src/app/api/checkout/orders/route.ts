import { NextResponse } from "next/server";
import { clientIp, rateLimited, tooManyRequests } from "@/lib/rateLimit";
import * as z from "zod/v4";
import { readResult } from "@/lib/check/pipeline";
import { createCheckoutOrder } from "@/lib/checkout";
import { getCheck } from "@/lib/db";
import { PayPalError } from "@/lib/paypal/client";

export const dynamic = "force-dynamic";

const Body = z.object({ check_id: z.string().min(1).max(64) });

// Creates a PayPal order (Orders v2) for the shop in a finished, passing Tier 1 check.
// The amount is taken from the shop's catalogue on the server, never from the request.
export async function POST(req: Request) {
  const wait = rateLimited("order", clientIp(req));
  if (wait) return tooManyRequests(wait);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Missing check_id" }, { status: 400 });
  const row = getCheck(parsed.data.check_id);
  if (!row || row.status !== "done") return NextResponse.json({ error: "Check not found or not finished" }, { status: 404 });
  try {
    return NextResponse.json(await createCheckoutOrder(row.id, readResult(row)), { status: 201 });
  } catch (err) {
    const msg = err instanceof PayPalError ? "PayPal couldn't create the order. Please try again." : err instanceof Error ? err.message : "Couldn't create the order";
    console.error("[checkout] create failed", err);
    return NextResponse.json({ error: msg }, { status: err instanceof PayPalError ? 502 : 403 });
  }
}
