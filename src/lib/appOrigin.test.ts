import { afterEach, describe, expect, it, vi } from "vitest";
import { appOrigin } from "./fetchPage";

describe("appOrigin", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers APP_URL, then Render's RENDER_EXTERNAL_URL, then the fallback", () => {
    vi.stubEnv("APP_URL", "https://vouch.example/");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://vouch-abc.onrender.com");
    expect(appOrigin("https://localhost:10000")).toBe("https://vouch.example");

    vi.stubEnv("APP_URL", "");
    expect(appOrigin("https://localhost:10000")).toBe("https://vouch-abc.onrender.com");

    vi.stubEnv("RENDER_EXTERNAL_URL", "");
    expect(appOrigin("https://localhost:10000")).toBe("https://localhost:10000");
    expect(appOrigin()).toBe("http://localhost:3000");
  });

  it("treats blank values as unset and strips trailing slashes", () => {
    vi.stubEnv("APP_URL", "   ");
    vi.stubEnv("RENDER_EXTERNAL_URL", "https://vouch-abc.onrender.com//");
    expect(appOrigin()).toBe("https://vouch-abc.onrender.com");
  });
});
