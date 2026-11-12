import { NextResponse, after, type NextRequest } from "next/server";
import { clientIp, rateLimited } from "@/lib/rateLimit";
import { runCheck } from "@/lib/check/pipeline";
import { createCheck, type CheckSource } from "@/lib/db";
import { extractFirstUrl } from "@/lib/extractUrl";
import { appOrigin } from "@/lib/fetchPage";

// PWA share target (manifest: action "/share", method GET, params title/text/url)
// and the entry point for pasted links and demo checks.
// Starts a check and redirects to its result page.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  // Not req.nextUrl.origin alone: on Render that is the internal https://localhost:10000.
  const origin = appOrigin(req.nextUrl.origin);
  const url = extractFirstUrl([sp.get("url"), sp.get("text"), sp.get("title")], origin);

  if (!url) {
    return NextResponse.redirect(new URL("/?error=no-link", origin), 303);
  }

  if (rateLimited("check", clientIp(req))) {
    return NextResponse.redirect(new URL("/?error=busy", origin), 303);
  }

  const from = sp.get("from");
  const source: CheckSource = from === "demo" || from === "link" ? from : "share";
  const sharedText = [sp.get("title"), sp.get("text")].filter(Boolean).join("\n") || undefined;
  const check = createCheck({ source, url, text: sharedText });
  after(() => runCheck(check.id));
  return NextResponse.redirect(new URL(`/check/${check.id}`, origin), 303);
}
