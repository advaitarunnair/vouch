import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

// Fetches ONLY pages a user explicitly submitted (or pages Vouch hosts), with SSRF
// protection: http(s) only, no private/loopback addresses (except our own origin),
// limited redirects, size and time limits.

export interface PageMeta {
  title?: string;
  description?: string;
  siteName?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogType?: string;
  ogUrl?: string;
  canonical?: string;
  ogImage?: string;
  price?: string;
  currency?: string;
}

export interface FetchedPage {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  https: boolean;
  meta: PageMeta;
  /** Visible text, whitespace-collapsed, capped at 20k chars. */
  text: string;
}

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

/**
 * The app's public origin. Behind a proxy (Render) the incoming request's own origin is an
 * internal address such as https://localhost:10000, so prefer configured values:
 * APP_URL, then Render's automatic RENDER_EXTERNAL_URL, then the fallback. Empty values count as unset.
 */
export function appOrigin(fallback?: string): string {
  const origin = process.env.APP_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || fallback || "http://localhost:3000";
  return origin.replace(/\/+$/, "");
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith("::ffff:")) return isPrivateIp(v6.slice(7));
  return v6 === "::1" || v6 === "::" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

export class UnsafeUrlError extends Error {
  name = "UnsafeUrlError";
}

async function assertPublic(url: URL, ownOrigin: string) {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UnsafeUrlError("Only http and https links can be checked");
  if (url.origin === new URL(ownOrigin).origin) return; // our own hosted shop pages
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) throw new UnsafeUrlError("That link points to a private network address, so Vouch won't open it");
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateIp(a.address))) throw new UnsafeUrlError("That link points to a private network address, so Vouch won't open it");
}

export async function fetchPage(rawUrl: string, ownOrigin = appOrigin()): Promise<FetchedPage> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(url, ownOrigin);
    const res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "User-Agent": "VouchBot/0.1 (shop trust check; fetches only user-submitted links)",
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
        "Accept-Language": "en",
      },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      continue;
    }
    const html = await readCapped(res);
    return {
      requestedUrl: rawUrl,
      finalUrl: url.toString(),
      status: res.status,
      https: url.protocol === "https:",
      meta: parseMeta(html),
      text: visibleText(html),
    };
  }
  throw new Error("Too many redirects");
}

async function readCapped(res: Response): Promise<string> {
  const type = res.headers.get("content-type") ?? "";
  if (type && !/html|xml|text/i.test(type)) return "";
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  await reader.cancel().catch(() => {});
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function parseMeta(html: string): PageMeta {
  const metas = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1]?.toLowerCase();
    const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
    if (key && content !== undefined && !metas.has(key)) metas.set(key, decode(content).trim());
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1];
  return {
    title: title ? decode(title).trim() : undefined,
    description: metas.get("description"),
    siteName: metas.get("og:site_name"),
    ogTitle: metas.get("og:title"),
    ogDescription: metas.get("og:description"),
    ogType: metas.get("og:type"),
    ogUrl: metas.get("og:url"),
    ogImage: metas.get("og:image"),
    canonical,
    price: metas.get("product:price:amount") ?? metas.get("og:price:amount") ?? metas.get("price"),
    currency: metas.get("product:price:currency") ?? metas.get("og:price:currency") ?? metas.get("pricecurrency"),
  };
}

export function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<\/(p|div|li|h[1-6]|section|br|tr|address)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
    .slice(0, 20_000);
}
