import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type * as z from "zod/v4";

// Thin wrapper around the Anthropic Messages API for schema-validated JSON output.
// Model comes from ANTHROPIC_MODEL (default claude-opus-5-5).

export const DEFAULT_MODEL = "claude-opus-5-5";
export const model = () => process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

// Models that accept the server-side refusal fallback `fallbacks: "default"`.
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic({ maxRetries: 2, timeout: 60_000 }));

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export type UserContent = Anthropic.Beta.BetaContentBlockParam[];

export interface StructuredResult<T> {
  data: T | null;
  /** Why data is null: not configured, refused, API error or unparseable output. */
  error?: string;
  ms: number;
  model: string;
}

export async function structured<T extends z.ZodType>(opts: {
  label: string;
  schema: T;
  system: string;
  /** A single user turn, or a full conversation via `messages`. */
  content?: UserContent;
  messages?: Anthropic.Beta.BetaMessageParam[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<StructuredResult<z.infer<T>>> {
  const started = Date.now();
  const m = model();
  if (!aiConfigured()) {
    console.warn(`[ai] ${opts.label} skipped: ANTHROPIC_API_KEY is not set`);
    return { data: null, error: "AI analysis isn't available right now.", ms: 0, model: m };
  }

  try {
    const useFallback = FALLBACK_MODELS.has(m);
    const response = await getClient().beta.messages.parse({
      model: m,
      max_tokens: opts.maxTokens ?? 4000,
      system: opts.system,
      messages: opts.messages ?? [{ role: "user", content: opts.content ?? [] }],
      output_config: { format: betaZodOutputFormat(opts.schema), effort: opts.effort ?? "low" },
      ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    const ms = Date.now() - started;
    console.info(`[ai] ${opts.label} model=${response.model} stop=${response.stop_reason} ${ms}ms`);

    if (response.stop_reason === "refusal") {
      return { data: null, error: "The AI declined this request", ms, model: response.model };
    }
    if (!response.parsed_output) {
      return { data: null, error: `AI returned no structured output (stop_reason ${response.stop_reason})`, ms, model: response.model };
    }
    return { data: response.parsed_output as z.infer<T>, ms, model: response.model };
  } catch (err) {
    const ms = Date.now() - started;
    let error = "AI request failed";
    if (err instanceof Anthropic.AuthenticationError) error = "AI credentials were rejected";
    else if (err instanceof Anthropic.RateLimitError) error = "AI is rate limited, try again shortly";
    else if (err instanceof Anthropic.BadRequestError) error = `AI request was invalid: ${err.message}`;
    else if (err instanceof Anthropic.APIError) error = `AI error ${err.status ?? ""}: ${err.message}`;
    console.error(`[ai] ${opts.label} failed after ${ms}ms`, err);
    return { data: null, error, ms, model: m };
  }
}
