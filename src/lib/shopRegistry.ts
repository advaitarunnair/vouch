// Maps shops Vouch knows about to their PayPal sandbox REST credentials.
// In production this would be PayPal's own merchant directory; here it is three
// sandbox business accounts, one per fictional shop.

import type { PayPalCredentials } from "@/lib/paypal/client";
import type { ShopSlug } from "@/lib/shops";

export type ShopKey = "aurora" | "glowbox" | "flashdeal";

export interface RegistryEntry {
  key: ShopKey;
  slug: ShopSlug;
  envPrefix: string;
  /** Hostnames (besides our own /shops/<slug> path) that identify this shop. */
  domains: string[];
}

export const SHOP_REGISTRY: RegistryEntry[] = [
  { key: "aurora", slug: "aurora-threads", envPrefix: "SHOP_AURORA", domains: ["aurora-threads.example"] },
  { key: "glowbox", slug: "glowbox", envPrefix: "SHOP_GLOWBOX", domains: ["glowbox.example"] },
  { key: "flashdeal", slug: "flashdeal-outlet", envPrefix: "SHOP_FLASHDEAL", domains: ["flashdeal-outlet.example"] },
];

export function registryByKey(key: string): RegistryEntry | undefined {
  return SHOP_REGISTRY.find((e) => e.key === key);
}

export function registryBySlug(slug: string): RegistryEntry | undefined {
  return SHOP_REGISTRY.find((e) => e.slug === slug);
}

/** Returns credentials, or null if the env vars are not configured. */
export function shopCredentials(entry: RegistryEntry): PayPalCredentials | null {
  const clientId = process.env[`${entry.envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${entry.envPrefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
