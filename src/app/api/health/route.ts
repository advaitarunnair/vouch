import { NextResponse } from "next/server";
import { aiConfigured } from "@/lib/ai/llm";
import { channel3Configured } from "@/lib/channel3";
import { db } from "@/lib/db";
import { appOrigin } from "@/lib/fetchPage";
import { SHOP_REGISTRY, shopCredentials } from "@/lib/shopRegistry";

export const dynamic = "force-dynamic";

// Render health check (and a quick status page for judges). No external calls, no secrets.
export function GET() {
  let database = "ok";
  try {
    db().prepare("SELECT 1").get();
  } catch {
    database = "error";
  }
  const body = {
    status: database === "ok" ? "ok" : "degraded",
    time: new Date().toISOString(),
    commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? null,
    app_url: appOrigin(), // public origin used for own-page detection and PayPal return URLs
    database,
    configured: {
      anthropic: aiConfigured(),
      channel3: channel3Configured(),
      paypal_env: process.env.PAYPAL_ENV ?? "sandbox",
      paypal_shops: SHOP_REGISTRY.filter((e) => shopCredentials(e)).map((e) => e.slug),
    },
  };
  return NextResponse.json(body, { status: database === "ok" ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
