import { NextResponse } from "next/server";
import { toView } from "@/lib/check/pipeline";
import { getCheck } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getCheck(id);
  if (!row) return NextResponse.json({ error: "Check not found" }, { status: 404 });
  return NextResponse.json(toView(row), { headers: { "Cache-Control": "no-store" } });
}
