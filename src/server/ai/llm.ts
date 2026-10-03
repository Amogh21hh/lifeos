import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "@/server/observability/logger";

/**
 * LLM provider abstraction.
 *
 * Agents never call a vendor SDK directly. They ask for a *structured* result validated by a Zod
 * schema. Providers:
 *   - anthropic          → official @anthropic-ai/sdk, structured outputs via output_config.format
 *   - openai_compatible  → any /chat/completions endpoint with json_schema response_format
 * If no provider is configured (or the user selects "local only"), getLLM() returns null and every
 * agent uses its deterministic reasoning path over the user's data. Nothing is ever faked.
 */
export type Engine = "anthropic" | "openai_compatible";

export interface LLMUsage {
  engine: Engine;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
}

export interface StructuredRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
  /** Optional base64 images for vision-capable providers. */
  images?: { mediaType: "image/png" | "image/jpeg" | "image/webp"; data: string }[];
}

export interface LLMProvider {
  engine: Engine;
  model: string;
  structured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: LLMUsage }>;
}

export class LLMError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

/** USD per 1M tokens (input, output). Unknown models are tracked at 0 and flagged in the UI. */
const PRICING: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-sonnet-5-5": [2, 10],
  "claude-haiku-4-5": [1, 5],
  "claude-fable-5-1": [10, 50],
};

export function estimateCost(model: string, input: number, output: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (input * p[0] + output * p[1]) / 1_000_000;
}

/** Structured-output JSON schema: strip validation keywords some providers reject; Zod re-validates after. */
export function toProviderSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  const STRIP = new Set(["$schema", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "default"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (STRIP.has(k)) continue;
      out[k] = walk(v);
    }
    if (out.type === "object" && out.properties && out.additionalProperties === undefined) out.additionalProperties = false;
    return out;
  };
  return walk(json) as Record<string, unknown>;
}

function parseJson<T>(text: string, schema: z.ZodType<T>): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    throw new LLMError("Model returned invalid JSON", true);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new LLMError(`Model output failed validation: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, true);
  return parsed.data;
}

class AnthropicProvider implements LLMProvider {
  engine = "anthropic" as const;
  private client: Anthropic;
  constructor(
    apiKey: string | undefined,
    public model: string,
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
  }

  async structured<T>(req: StructuredRequest<T>) {
    const start = performance.now();
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })),
      { type: "text" as const, text: req.prompt },
    ];
    const useFallbacks = process.env.ANTHROPIC_FALLBACKS !== "false";
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: req.maxTokens ?? 8000,
        system: req.system,
        messages: [{ role: "user", content }],
        output_config: {
          effort: (process.env.ANTHROPIC_EFFORT as "low" | "medium" | "high") ?? "medium",
          format: { type: "json_schema", schema: toProviderSchema(req.schema) },
        },
        ...(useFallbacks ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) throw new LLMError("Anthropic rate limit reached", true);
      if (err instanceof Anthropic.AuthenticationError) throw new LLMError("Anthropic API key rejected", false);
      if (err instanceof Anthropic.BadRequestError) throw new LLMError(`Anthropic rejected the request: ${err.message}`, false);
      if (err instanceof Anthropic.APIConnectionError) throw new LLMError("Could not reach Anthropic API", true);
      if (err instanceof Anthropic.APIError) throw new LLMError(`Anthropic API error ${err.status}`, (err.status ?? 500) >= 500);
      throw err;
    }
    if (message.stop_reason === "refusal") throw new LLMError("The model declined this request", false);
    if (message.stop_reason === "max_tokens") throw new LLMError("Model output was truncated (max_tokens)", true);
    const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    const data = parseJson(text, req.schema);
    const usage: LLMUsage = {
      engine: "anthropic",
      model: message.model,
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      costUsd: estimateCost(this.model, message.usage.input_tokens, message.usage.output_tokens),
      latencyMs: Math.round(performance.now() - start),
    };
    return { data, usage };
  }
}

class OpenAICompatibleProvider implements LLMProvider {
  engine = "openai_compatible" as const;
  constructor(
    private baseUrl: string,
    private apiKey: string | undefined,
    public model: string,
  ) {}

  async structured<T>(req: StructuredRequest<T>) {
    const start = performance.now();
    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({
        model: this.model,
        max_tokens: req.maxTokens ?? 8000,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content: req.prompt },
        ],
        response_format: { type: "json_schema", json_schema: { name: "result", schema: toProviderSchema(req.schema), strict: false } },
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(() => {
      throw new LLMError("Could not reach OpenAI-compatible endpoint", true);
    });
    if (!res.ok) throw new LLMError(`OpenAI-compatible endpoint returned HTTP ${res.status}`, res.status >= 500 || res.status === 429);
    const json = (await res.json()) as { choices: { message: { content: string } }[]; usage?: { prompt_tokens: number; completion_tokens: number } };
    const data = parseJson(json.choices?.[0]?.message?.content ?? "", req.schema);
    return {
      data,
      usage: {
        engine: "openai_compatible" as const,
        model: this.model,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
        costUsd: 0,
        latencyMs: Math.round(performance.now() - start),
      },
    };
  }
}

export interface AIStatus {
  available: boolean;
  engine: Engine | "local";
  model: string | null;
  reason: string;
}

export function aiStatus(): AIStatus {
  const provider = process.env.AI_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_COMPAT_BASE_URL ? "openai_compatible" : "local");
  if (provider === "anthropic" && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN))
    return { available: true, engine: "anthropic", model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5", reason: "Anthropic API key configured" };
  if (provider === "openai_compatible" && process.env.OPENAI_COMPAT_BASE_URL)
    return { available: true, engine: "openai_compatible", model: process.env.OPENAI_COMPAT_MODEL ?? "gpt-4o-mini", reason: `OpenAI-compatible endpoint ${process.env.OPENAI_COMPAT_BASE_URL}` };
  return { available: false, engine: "local", model: null, reason: "No AI provider configured — using the local reasoning engine." };
}

let cached: LLMProvider | null | undefined;

/** Returns a provider, or null when running local-only. `mode` comes from user settings. */
export function getLLM(mode: "auto" | "local" = "auto"): LLMProvider | null {
  if (mode === "local") return null;
  if (cached !== undefined) return cached;
  const status = aiStatus();
  if (!status.available) cached = null;
  else if (status.engine === "anthropic") cached = new AnthropicProvider(process.env.ANTHROPIC_API_KEY, status.model!);
  else cached = new OpenAICompatibleProvider(process.env.OPENAI_COMPAT_BASE_URL!, process.env.OPENAI_COMPAT_API_KEY, status.model!);
  logger.info("ai.provider", { engine: status.engine, model: status.model });
  return cached;
}
