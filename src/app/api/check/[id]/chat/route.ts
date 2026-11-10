import { NextResponse } from "next/server";
import { clientIp, rateLimited, tooManyRequests } from "@/lib/rateLimit";
import * as z from "zod/v4";
import { answerQuestion } from "@/lib/ai/chat";
import { readResult } from "@/lib/check/pipeline";
import { getCheck } from "@/lib/db";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().trim().min(1).max(500),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }))
    .max(20)
    .default([]),
});

// Grounded chatbot for one finished check.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const wait = rateLimited("chat", clientIp(req));
  if (wait) return tooManyRequests(wait);
  const row = getCheck(id);
  if (!row) return NextResponse.json({ error: "Check not found" }, { status: 404 });
  if (row.status !== "done") return NextResponse.json({ error: "Ask again once the check has finished" }, { status: 409 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ask a question of up to 500 characters" }, { status: 400 });
  if (parsed.data.history.filter((t) => t.role === "user").length >= 10) {
    return NextResponse.json({ error: "That's the question limit for this check" }, { status: 429 });
  }
  const reply = await answerQuestion(readResult(row), parsed.data.history, parsed.data.question);
  return NextResponse.json(reply);
}
