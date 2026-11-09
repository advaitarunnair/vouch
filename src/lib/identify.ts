import "server-only";
import * as z from "zod/v4";
import { structured } from "@/lib/ai/llm";
import { UnsafeUrlError, appOrigin, fetchPage, type FetchedPage, type PageMeta } from "@/lib/fetchPage";
import { SHOP_REGISTRY, registryBySlug, type RegistryEntry } from "@/lib/shopRegistry";
import { formatPrice, getShop } from "@/lib/shops";

export const CONFIDENCE_THRESHOLD = 0.7;

export type IdentifyMethod = "own_shop_page" | "registry_domain" | "page_domain" | "ai_link_preview" | "ai_screenshot" | "user_confirmed";

export interface ShopCandidate {
  shop_name: string;
  shop_domain: string | null;
  /** Set when the candidate is one of the shops in Vouch's PayPal registry. */
  registry_slug?: string;
}

export interface Identification {
  method: IdentifyMethod;
  shop_name: string | null;
  shop_domain: string | null;
  registry_slug: string | null;
  confidence: number;
  product: string | null;
  price: string | null;
  /** The shop page Vouch may fetch and scan (only pages the user submitted or that Vouch hosts). */
  page_url: string | null;
  evidence: string;
  candidates: ShopCandidate[];
  ai?: { model: string; ms: number; error?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function hostOf(domainOrUrl: string | null | undefined): string | null {
  if (!domainOrUrl) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(domainOrUrl) ? domainOrUrl : `https://${domainOrUrl}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/** Our own hosted shop page: <appOrigin>/shops/<slug>. */
function ownShopEntry(url: URL, origin: string): RegistryEntry | undefined {
  if (url.origin !== new URL(origin).origin) return undefined;
  const slug = url.pathname.match(/^\/shops\/([a-z0-9-]+)\/?$/)?.[1];
  return slug ? registryBySlug(slug) : undefined;
}

/** Match an AI- or user-supplied name/domain against shops in the PayPal registry. */
export function matchRegistry(name: string | null | undefined, domain: string | null | undefined): RegistryEntry | undefined {
  const host = hostOf(domain);
  if (host) {
    const byDomain = SHOP_REGISTRY.find((e) => e.domains.includes(host));
    if (byDomain) return byDomain;
    // e.g. "vouch-demo.onrender.com/shops/glowbox"
    const slug = domain?.match(/\/shops\/([a-z0-9-]+)/)?.[1];
    if (slug && registryBySlug(slug)) return registryBySlug(slug);
  }
  const n = norm(name);
  if (!n) return undefined;
  return SHOP_REGISTRY.find((e) => {
    const shopName = norm(getShop(e.slug)?.name);
    return shopName === n || norm(e.slug) === n || (n.length >= 5 && (shopName.includes(n) || n.includes(shopName)));
  });
}

function candidateFor(entry: RegistryEntry): ShopCandidate {
  return { shop_name: getShop(entry.slug)!.name, shop_domain: entry.domains[0], registry_slug: entry.slug };
}

function registryIdentification(entry: RegistryEntry, method: IdentifyMethod, evidence: string, pageUrl: string | null, extra?: Partial<Identification>): Identification {
  const shop = getShop(entry.slug)!;
  return {
    method,
    shop_name: shop.name,
    shop_domain: entry.domains[0],
    registry_slug: entry.slug,
    confidence: 1,
    product: shop.product.name,
    price: formatPrice(shop.product.price),
    page_url: pageUrl ?? `${appOrigin()}/shops/${entry.slug}`,
    evidence,
    candidates: [],
    ...extra,
  };
}

/**
 * A link that points at a post/video/short link rather than a shop. Generic URL
 * patterns only; Vouch never fetches more than the link preview metadata of these.
 */
export function looksSocialStyle(url: URL): boolean {
  const segs = url.pathname.split("/").filter(Boolean);
  if (segs.some((s) => s.startsWith("@"))) return true;
  if (segs.some((s) => /^(p|post|posts|reel|reels|video|videos|status|statuses|watch|shorts|share|story|stories|pin)$/i.test(s))) return true;
  if (url.pathname.startsWith("/feed/")) return true; // our own demo feed
  // URL shorteners: tiny host + one short opaque path segment
  const labels = url.hostname.split(".");
  return labels.length === 2 && labels[0].length <= 4 && segs.length === 1 && segs[0].length <= 12;
}

// ---------------------------------------------------------------------------
// AI extraction schemas
// ---------------------------------------------------------------------------

const ShopGuess = z.object({
  shop_name: z.string().nullable().describe("The shop/brand selling the product, or null if not identifiable"),
  shop_domain: z.string().nullable().describe("The shop's website domain if stated or clearly implied, else null. Never invent one."),
  confidence: z.number().describe("0 to 1: how sure you are this is the selling shop"),
  product: z.string().nullable(),
  price: z.string().nullable().describe("Price as shown, e.g. '$12.99', or null"),
  evidence: z.string().describe("One short sentence citing what in the input identifies the shop"),
  alternatives: z.array(z.object({ shop_name: z.string(), shop_domain: z.string().nullable() })).describe("Other plausible shops, at most 3"),
});

const LINK_SYSTEM = `You identify which online shop is selling the product promoted by a shared link.
You only see the link's preview metadata (title, description, Open Graph tags), never the page itself.
Rules:
- Base every field on the metadata. Do not use outside knowledge to guess a shop that is not named or implied.
- shop_domain: only if a domain appears or is unambiguously implied; otherwise null.
- confidence: 0.9+ only when the shop is named explicitly; 0.4-0.7 when it is only implied; below 0.4 when unknown.
- If the shop is not identifiable, set shop_name to null and suggest likely candidates in alternatives (from the known shops list if relevant).`;

const SCREENSHOT_SYSTEM = `You read screenshots of online ads, product pages and social posts and extract what is being sold and by which shop.
Rules:
- Only report text and logos you can actually see. Do not guess a shop that is not visible.
- shop_domain: only if a URL or domain is visible (address bar, caption, watermark); otherwise null.
- price: exactly as displayed, including the currency symbol.
- confidence: 0.9+ only when the shop name or domain is clearly visible; lower when inferred; below 0.4 when unknown.
- If the shop is not identifiable, set shop_name to null and list plausible candidates in alternatives.`;

function knownShopsNote(): string {
  return `Known shops in Vouch's PayPal registry (only for matching names you see, not for guessing):\n${SHOP_REGISTRY.map(
    (e) => `- ${getShop(e.slug)!.name} (${e.domains[0]})`,
  ).join("\n")}`;
}

function fromGuess(
  guess: z.infer<typeof ShopGuess>,
  method: IdentifyMethod,
  ai: Identification["ai"],
): Identification {
  const entry = matchRegistry(guess.shop_name, guess.shop_domain);
  const candidates: ShopCandidate[] = [];
  const push = (c: ShopCandidate) => {
    if (!candidates.some((x) => norm(x.shop_name) === norm(c.shop_name))) candidates.push(c);
  };
  if (guess.shop_name) push(entry ? candidateFor(entry) : { shop_name: guess.shop_name, shop_domain: guess.shop_domain });
  for (const alt of guess.alternatives.slice(0, 3)) {
    const e = matchRegistry(alt.shop_name, alt.shop_domain);
    push(e ? candidateFor(e) : alt);
  }

  const shop = entry ? getShop(entry.slug)! : null;
  return {
    method,
    shop_name: shop?.name ?? guess.shop_name,
    shop_domain: entry?.domains[0] ?? hostOf(guess.shop_domain),
    registry_slug: entry?.slug ?? null,
    confidence: Math.max(0, Math.min(1, guess.confidence)),
    product: guess.product,
    price: guess.price,
    // Inferred shops are not pages the user submitted; only our hosted pages can be scanned.
    page_url: entry ? `${appOrigin()}/shops/${entry.slug}` : null,
    evidence: guess.evidence,
    candidates,
    ai,
  };
}

function unidentified(method: IdentifyMethod, evidence: string, ai?: Identification["ai"]): Identification {
  return {
    method,
    shop_name: null,
    shop_domain: null,
    registry_slug: null,
    confidence: 0,
    product: null,
    price: null,
    page_url: null,
    evidence,
    candidates: SHOP_REGISTRY.map(candidateFor),
    ai,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface LinkIdentifyResult {
  identification: Identification;
  /** Page fetched while identifying (full page for shop links, metadata-only use for social links). */
  page: FetchedPage | null;
  fetchError?: string;
}

export async function identifyFromUrl(rawUrl: string): Promise<LinkIdentifyResult> {
  const origin = appOrigin();
  const url = new URL(rawUrl);

  // 1. One of the shop pages Vouch hosts.
  const own = ownShopEntry(url, origin);
  if (own) {
    return {
      identification: registryIdentification(own, "own_shop_page", `The link is the ${getShop(own.slug)!.name} shop page.`, url.toString()),
      page: null,
    };
  }

  // 2. A domain already in the PayPal registry.
  const host = url.hostname.replace(/^www\./, "");
  const byDomain = SHOP_REGISTRY.find((e) => e.domains.includes(host));
  if (byDomain) {
    return {
      identification: registryIdentification(byDomain, "registry_domain", `${host} belongs to ${getShop(byDomain.slug)!.name}.`, url.toString()),
      page: null,
    };
  }

  let page: FetchedPage | null = null;
  let fetchError: string | undefined;
  try {
    page = await fetchPage(url.toString(), origin);
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw err;
    fetchError = err instanceof Error ? err.message : String(err);
  }

  // 3. A normal web page: the shop is its domain.
  if (!looksSocialStyle(url)) {
    const finalHost = hostOf(page?.finalUrl ?? url.toString())!;
    const name = page?.meta.siteName ?? page?.meta.ogTitle ?? page?.meta.title ?? finalHost;
    return {
      identification: {
        method: "page_domain",
        shop_name: name,
        shop_domain: finalHost,
        registry_slug: null,
        confidence: 0.9,
        product: page?.meta.ogTitle ?? page?.meta.title ?? null,
        price: page?.meta.price ? `${page.meta.price}${page.meta.currency ? ` ${page.meta.currency}` : ""}` : null,
        page_url: page ? page.finalUrl : url.toString(),
        evidence: `The link goes straight to ${finalHost}.`,
        candidates: [],
      },
      page,
      fetchError,
    };
  }

  // 4. A social-style or short link: ask the AI, using the link preview metadata only.
  if (!page) {
    return { identification: unidentified("ai_link_preview", `Couldn't load the link preview (${fetchError}).`), page, fetchError };
  }
  const meta: PageMeta & { url: string; final_url: string } = { url: url.toString(), final_url: page.finalUrl, ...page.meta };
  const res = await structured({
    label: "identify-link",
    schema: ShopGuess,
    system: LINK_SYSTEM,
    content: [
      { type: "text", text: `${knownShopsNote()}\n\nLink preview metadata (JSON):\n${JSON.stringify(meta, null, 2)}` },
    ],
  });
  const ai = { model: res.model, ms: res.ms, error: res.error };
  if (!res.data) {
    return { identification: unidentified("ai_link_preview", res.error ?? "AI could not identify the shop.", ai), page, fetchError };
  }
  return { identification: fromGuess(res.data, "ai_link_preview", ai), page, fetchError };
}

export async function identifyFromScreenshot(image: { mime: string; data: Buffer }): Promise<Identification> {
  const media = image.mime as "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  const res = await structured({
    label: "identify-screenshot",
    schema: ShopGuess,
    system: SCREENSHOT_SYSTEM,
    content: [
      { type: "image", source: { type: "base64", media_type: media, data: image.data.toString("base64") } },
      { type: "text", text: `${knownShopsNote()}\n\nWhich shop is selling the product in this screenshot?` },
    ],
  });
  const ai = { model: res.model, ms: res.ms, error: res.error };
  if (!res.data) return unidentified("ai_screenshot", res.error ?? "AI could not read the screenshot.", ai);
  return fromGuess(res.data, "ai_screenshot", ai);
}

/** The user picked (or typed) the shop on the "Is this the shop?" step. */
export function confirmShop(prev: Identification, choice: { shop_name: string; shop_domain: string | null }): Identification {
  const entry = matchRegistry(choice.shop_name, choice.shop_domain);
  if (entry) {
    return registryIdentification(entry, "user_confirmed", `You confirmed the shop is ${getShop(entry.slug)!.name}.`, null, {
      product: prev.product ?? getShop(entry.slug)!.product.name,
      price: prev.price ?? formatPrice(getShop(entry.slug)!.product.price),
    });
  }
  const host = hostOf(choice.shop_domain);
  return {
    ...prev,
    method: "user_confirmed",
    shop_name: choice.shop_name,
    shop_domain: host,
    registry_slug: null,
    confidence: 1,
    // The user explicitly named this shop's site, so its home page may be scanned.
    page_url: host ? `https://${host}/` : null,
    evidence: `You confirmed the shop is ${choice.shop_name}.`,
    candidates: [],
  };
}
