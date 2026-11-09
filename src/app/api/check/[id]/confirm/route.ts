import { NextResponse, after } from "next/server";
import * as z from "zod/v4";
import { readResult, runCheck, toView } from "@/lib/check/pipeline";
import { getCheck, updateCheck } from "@/lib/db";
import { confirmShop } from "@/lib/identify";

export const dynamic = "force-dynamic";

const Body = z.object({
  shop_name: z.string().trim().min(1).max(120),
  shop_domain: z.string().trim().max(253).nullable().optional(),
});

// "Is this the shop?" answer. Records the user's choice and continues the check.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getCheck(id);
  if (!row) return NextResponse.json({ error: "Check not found" }, { status: 404 });
  if (row.status !== "needs_confirmation") return NextResponse.json({ error: "This check isn't waiting for confirmation" }, { status: 409 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pick a shop or type its name" }, { status: 400 });

  const result = readResult(row);
  if (!result.identification) return NextResponse.json({ error: "Nothing to confirm" }, { status: 409 });
  result.identification = confirmShop(result.identification, {
    shop_name: parsed.data.shop_name,
    shop_domain: parsed.data.shop_domain ?? null,
  });
  result.steps.identify = { ...result.steps.identify, status: "done", note: `${result.identification.shop_name} (confirmed by you)` };
  updateCheck(id, { status: "pending", result });
  after(() => runCheck(id));
  return NextResponse.json(toView(getCheck(id)!), { status: 202 });
}
