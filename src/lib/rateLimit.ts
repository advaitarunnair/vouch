// Fixed-window, in-memory rate limiter keyed by client IP. Good enough for a single
// Render instance: it keeps bots from burning AI and search credits on the public demo.

const buckets = new Map<string, { count: number; resetAt: number }>();

export const LIMITS = {
  check: { max: 30, windowMs: 60 * 60 * 1000 }, // new checks (links, shares, screenshots) per hour
  chat: { max: 60, windowMs: 60 * 60 * 1000 },
  order: { max: 30, windowMs: 60 * 60 * 1000 },
} as const;

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

/** Returns null when allowed, or the number of seconds until the window resets. */
export function rateLimited(kind: keyof typeof LIMITS, key: string, now = Date.now()): number | null {
  const { max, windowMs } = LIMITS[kind];
  const id = `${kind}:${key}`;
  const b = buckets.get(id);
  if (!b || b.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
    return null;
  }
  if (b.count >= max) return Math.ceil((b.resetAt - now) / 1000);
  b.count++;
  return null;
}

export function tooManyRequests(retryAfter: number) {
  return Response.json(
    { error: "You've made a lot of requests. Please try again a little later." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}
