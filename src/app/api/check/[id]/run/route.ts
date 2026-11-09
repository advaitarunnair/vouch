import { NextResponse, after } from "next/server";
import { runCheck, toView } from "@/lib/check/pipeline";
import { getCheck } from "@/lib/db";

export const dynamic = "force-dynamic";

// Starts (or resumes) a pending check in the background. Safe to call repeatedly.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const row = getCheck(id);
  if (!row) return NextResponse.json({ error: "Check not found" }, { status: 404 });
  after(() => runCheck(id));
  return NextResponse.json(toView(row), { status: 202 });
}
