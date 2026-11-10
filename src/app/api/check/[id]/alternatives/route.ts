import { NextResponse } from "next/server";
import { alternativesFor } from "@/lib/alternatives";
import { readResult } from "@/lib/check/pipeline";
import { getCheck } from "@/lib/db";

export const dynamic = "force-dynamic";

// Safer alternatives for a finished check, fetched at display time so offer links stay fresh.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getCheck(id);
  if (!row) return NextResponse.json({ error: "Check not found" }, { status: 404 });
  if (row.status !== "done") return NextResponse.json({ error: "Check isn't finished yet" }, { status: 409 });
  try {
    return NextResponse.json(await alternativesFor(readResult(row)), { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error(`[alternatives ${id}]`, err);
    return NextResponse.json({ query: null, alternatives: [], fetched_at: null, error: "Couldn't load alternatives right now" });
  }
}
