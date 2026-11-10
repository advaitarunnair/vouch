import "server-only";
import * as z from "zod/v4";
import { structured } from "@/lib/ai/llm";

// Turns a shop's (possibly made-up) product name and page claims into a generic,
// brand-free search query, so the price check compares like with like.

const MarketQuery = z.object({
  query: z.string().describe("3-7 word generic product search query: product type plus its key claimed features. No shop or brand names, no marketing words."),
});

const SYSTEM = `You write search queries for comparing a product's price with similar products at other retailers.
Rules:
- Describe the product type and the key features the listing claims (for example "noise cancelling", "100% merino", "LED light therapy").
- Never include the shop name, the product's own brand or model name, prices, or hype words like "premium", "best" or "90% off".
- 3 to 7 words, lowercase.`;

export async function marketQueryFor(input: { product: string; title?: string; description?: string; pageText?: string }): Promise<{ query: string; ai: boolean }> {
  const fallback = { query: input.product, ai: false };
  const details = [
    `Product name: ${input.product}`,
    input.title && `Page title: ${input.title}`,
    input.description && `Description: ${input.description}`,
    input.pageText && `Page text (excerpt):\n${input.pageText.slice(0, 1500)}`,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await structured({ label: "market-query", schema: MarketQuery, system: SYSTEM, content: [{ type: "text", text: details }], maxTokens: 1000 });
  const q = res.data?.query?.trim();
  return q ? { query: q, ai: true } : fallback;
}
