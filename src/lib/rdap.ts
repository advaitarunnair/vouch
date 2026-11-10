import "server-only";
import { cacheGet, cacheSet } from "@/lib/db";

// Domain registration date via RDAP (the structured successor to WHOIS).
// The registry RDAP server is found via the IANA bootstrap file, e.g. rdap.verisign.com for .com.

export interface DomainAge {
  domain: string;
  registered_at: string | null;
  age_days: number | null;
  source: string | null;
  error?: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DAY = 86_400_000;

interface RdapDomain {
  ldhName?: string;
  events?: { eventAction?: string; eventDate?: string }[];
}

/** Registration date from an RDAP domain response (pure; unit-tested). */
export function registrationDate(rdap: RdapDomain): string | null {
  return rdap.events?.find((e) => e.eventAction === "registration")?.eventDate ?? null;
}

/** "shop.example.co.uk" → ["shop.example.co.uk", "example.co.uk", "co.uk"]: try from most to least specific. */
export function domainCandidates(host: string): string[] {
  const labels = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(".");
  const out: string[] = [];
  for (let i = 0; i <= labels.length - 2; i++) out.push(labels.slice(i).join("."));
  return out;
}

const HEADERS = { Accept: "application/rdap+json, application/json", "User-Agent": "VouchBot/0.1 (shop trust check)" };

/** IANA's RDAP bootstrap file maps each TLD to its registry's RDAP base URL (RFC 9224). */
const BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

/** RDAP base URL for a TLD from the IANA bootstrap services list (pure; unit-tested). */
export function serverFromBootstrap(services: [string[], string[]][], tld: string): string | null {
  const urls = services.find(([tlds]) => tlds.includes(tld.toLowerCase()))?.[1] ?? [];
  return urls.find((u) => u.startsWith("https://")) ?? urls[0] ?? null;
}

async function rdapServerFor(tld: string): Promise<string | null> {
  let services = cacheGet<[string[], string[]][]>("rdap:bootstrap:v1");
  if (!services) {
    const res = await fetch(BOOTSTRAP_URL, { headers: HEADERS, signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`IANA bootstrap returned ${res.status}`);
    services = ((await res.json()) as { services: [string[], string[]][] }).services;
    cacheSet("rdap:bootstrap:v1", services, CACHE_TTL_MS);
  }
  const url = serverFromBootstrap(services, tld);
  return url && !url.endsWith("/") ? `${url}/` : url;
}

export async function domainAge(host: string, now = new Date()): Promise<DomainAge> {
  const key = `rdap:v1:${host.toLowerCase()}`;
  const hit = cacheGet<DomainAge>(key);
  if (hit) return hit;

  let lastError = "No RDAP record found";
  const candidates = domainCandidates(host);
  const tld = candidates.at(-1)?.split(".").at(-1) ?? "";
  let server: string | null;
  try {
    server = await rdapServerFor(tld);
  } catch (err) {
    return { domain: host, registered_at: null, age_days: null, source: null, error: `RDAP bootstrap failed: ${err instanceof Error ? err.message : err}` };
  }
  if (!server) return { domain: host, registered_at: null, age_days: null, source: null, error: `No RDAP server for .${tld}` };

  for (const candidate of candidates) {
    try {
      const res = await fetch(new URL(`domain/${encodeURIComponent(candidate)}`, server), {
        headers: HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(7000),
      });
      if (res.status === 404) continue; // e.g. a subdomain: try the parent
      if (!res.ok) {
        lastError = `RDAP returned ${res.status}`;
        continue;
      }
      const body = (await res.json()) as RdapDomain;
      const registered = registrationDate(body);
      const result: DomainAge = {
        domain: candidate,
        registered_at: registered,
        age_days: registered ? Math.max(0, Math.floor((now.getTime() - Date.parse(registered)) / DAY)) : null,
        source: new URL(res.url).host,
      };
      cacheSet(key, result, CACHE_TTL_MS);
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  return { domain: host, registered_at: null, age_days: null, source: null, error: lastError };
}
