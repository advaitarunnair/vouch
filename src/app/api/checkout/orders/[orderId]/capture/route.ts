import { NextResponse } from "next/server";
import * as z from "zod/v4";
import { captureCheckoutOrder } from "@/lib/checkout";

export const dynamic = "force-dynamic";

const Body = z.object({ check_id: z.string().min(1).max(64) });

// Captures an approved order server-side with the shop's own credentials.
export async function POST(req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !/^[A-Z0-9]{10,30}$/.test(orderId)) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const outcome = await captureCheckoutOrder(orderId, parsed.data.check_id);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error, issue: outcome.issue }, { status: outcome.status });
  return NextResponse.json({ orderId: outcome.order.id, status: outcome.order.status });
}
