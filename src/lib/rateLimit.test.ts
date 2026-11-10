import { describe, expect, it } from "vitest";
import { LIMITS, clientIp, rateLimited } from "./rateLimit";

describe("rateLimited", () => {
  it("allows up to the limit per window, then reports seconds until reset", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < LIMITS.chat.max; i++) expect(rateLimited("chat", "ip-a", t0)).toBeNull();
    const wait = rateLimited("chat", "ip-a", t0 + 1000);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(LIMITS.chat.windowMs / 1000);
    expect(rateLimited("chat", "ip-b", t0)).toBeNull(); // other clients unaffected
    expect(rateLimited("order", "ip-a", t0)).toBeNull(); // separate budget per kind
    expect(rateLimited("chat", "ip-a", t0 + LIMITS.chat.windowMs + 1)).toBeNull(); // new window
  });

  it("reads the first forwarded IP", () => {
    expect(clientIp(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
    expect(clientIp(new Request("http://x"))).toBe("local");
  });
});
