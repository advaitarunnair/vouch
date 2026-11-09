/**
 * Finds the first link in what a user shared or pasted. Android share sheets often
 * put the link in `text` ("Look at this! https://…") rather than `url`.
 * Relative paths (our own /shops pages) are resolved against `origin`.
 */
export function extractFirstUrl(candidates: (string | null | undefined)[], origin: string): string | null {
  for (const raw of candidates) {
    const c = raw?.trim();
    if (!c) continue;
    if (c.startsWith("/") && !c.startsWith("//")) return new URL(c, origin).toString();

    const match = c.match(/https?:\/\/[^\s<>"'`]+/i);
    if (match) return trimTrailingPunctuation(match[0]);

    // Bare domain such as "shop.example/item/42"
    const bare = c.match(/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?$/i);
    if (bare) return `https://${trimTrailingPunctuation(bare[0])}`;
  }
  return null;
}

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[).,!?;:'"\]]+$/, "");
}
