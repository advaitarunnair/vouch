// Minimal PayPal REST client (server-side only).
// Docs: https://developer.paypal.com/api/rest/authentication/ (OAuth 2.0 client credentials)
// Base URL from the official OpenAPI specs: https://api-m.sandbox.paypal.com

export interface PayPalCredentials {
  clientId: string;
  clientSecret: string;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
    public debugId?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }

  /** PayPal error `name` / first `details[].issue`, if present. */
  get issue(): string | undefined {
    const b = this.body as { name?: string; details?: { issue?: string }[] } | undefined;
    return b?.details?.[0]?.issue ?? b?.name;
  }
}

export function paypalBaseUrl(): string {
  const env = (process.env.PAYPAL_ENV ?? "sandbox").toLowerCase();
  if (env !== "sandbox") {
    // Vouch is a hackathon demo: refuse to talk to live PayPal.
    throw new Error(`PAYPAL_ENV must be "sandbox" (got "${env}")`);
  }
  return "https://api-m.sandbox.paypal.com";
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getAccessToken(creds: PayPalCredentials): Promise<string> {
  const cached = tokenCache.get(creds.clientId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PayPalError(`PayPal OAuth failed (${res.status})`, res.status, body, res.headers.get("paypal-debug-id") ?? undefined);
  }
  const { access_token, expires_in } = body as { access_token: string; expires_in: number };
  tokenCache.set(creds.clientId, { token: access_token, expiresAt: Date.now() + expires_in * 1000 });
  return access_token;
}

export interface PayPalRequestOptions {
  method?: "GET" | "POST" | "PATCH";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  requestId?: string; // PayPal-Request-Id (idempotency)
  prefer?: "return=minimal" | "return=representation";
  retries?: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function paypalRequest<T = unknown>(
  creds: PayPalCredentials,
  path: string,
  opts: PayPalRequestOptions = {},
): Promise<T> {
  const { method = "GET", query, body, requestId, prefer, retries = 3 } = opts;
  const url = new URL(path, paypalBaseUrl());
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  for (let attempt = 0; ; attempt++) {
    const token = await getAccessToken(creds);
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    if (prefer) headers["Prefer"] = prefer;

    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    const json = text ? safeJson(text) : {};

    if (res.ok) return json as T;

    if (res.status === 401) tokenCache.delete(creds.clientId);
    const retryable = res.status === 401 || res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries) {
      await sleep(500 * 2 ** attempt);
      continue;
    }
    const debugId = res.headers.get("paypal-debug-id") ?? undefined;
    const msg = (json as { message?: string })?.message ?? res.statusText;
    throw new PayPalError(`PayPal ${method} ${url.pathname} failed (${res.status}): ${msg}`, res.status, json, debugId);
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
