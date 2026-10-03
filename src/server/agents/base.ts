/**
 * Agent runtime.
 *
 * An agent is a narrowly-scoped worker with:
 *   - a clear responsibility,
 *   - Zod input and output schemas (validated on every run),
 *   - an explicit tool allowlist (enforced by the tool registry),
 *   - access to an optional LLM whose usage is metered and logged,
 *   - structured error handling: failures are recorded and surfaced, never swallowed.
 *
 * Deterministic engines do the reasoning over the user's data; the LLM (when configured) is used
 * for language tasks — intent parsing, extraction, drafting and narration — and always receives the
 * computed facts as grounding.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getLLM, LLMError, type LLMProvider, type StructuredRequest } from "@/server/ai/llm";
import { executeTool, makeToolContext, type ToolResult } from "@/server/tools/registry";
import "@/server/tools/definitions";
import type { World } from "@/server/engine/world";
import type { ResultBlock } from "@/lib/types";
import { logger } from "@/server/observability/logger";

export const ResultBlockSchema = z.object({ type: z.string() }).passthrough();
export const AgentOutputSchema = z.object({ summary: z.string(), blocks: z.array(ResultBlockSchema) });
export type AgentOutput = { summary: string; blocks: ResultBlock[] };

export interface TraceStep {
  kind: "tool" | "llm" | "note";
  name: string;
  status: string;
  ms?: number;
  detail?: string;
}

export interface AgentContext {
  db: DB;
  userId: string;
  runId: string;
  agent: string;
  llm: LLMProvider | null;
  world(): Promise<World>;
  tool<O = unknown>(name: string, input: unknown): Promise<ToolResult<O>>;
  /** Tool call that must succeed; throws with the tool's error otherwise. */
  need<O = unknown>(name: string, input: unknown): Promise<O>;
  llmStructured<T>(req: StructuredRequest<T>): Promise<T | null>;
  note(text: string): void;
  trace: TraceStep[];
}

export interface AgentDefinition<I, O extends AgentOutput = AgentOutput> {
  name: string;
  description: string;
  responsibilities: string[];
  input: z.ZodType<I>;
  output?: z.ZodType<O>;
  tools: string[];
  run(ctx: AgentContext, input: I): Promise<O>;
}

export function defineAgent<I, O extends AgentOutput = AgentOutput>(def: AgentDefinition<I, O>) {
  return def;
}

export interface RunResult<O> {
  runId: string;
  output: O;
  status: "ok" | "error" | "partial";
  engine: string;
  model: string | null;
  latencyMs: number;
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
  trace: TraceStep[];
  error?: string;
}

export async function runAgent<I, O extends AgentOutput>(
  db: DB,
  userId: string,
  def: AgentDefinition<I, O>,
  rawInput: unknown,
  opts: { parentRunId?: string; intent?: string; aiMode?: "auto" | "local" } = {},
): Promise<RunResult<O>> {
  const started = performance.now();
  const llm = getLLM(opts.aiMode ?? "auto");
  const [run] = await db
    .insert(s.aiRuns)
    .values({ userId, agent: def.name, intent: opts.intent, parentRunId: opts.parentRunId, input: rawInput as object, status: "running", engine: llm?.engine ?? "local", model: llm?.model })
    .returning({ id: s.aiRuns.id });
  const toolCtx = makeToolContext(db, userId, def.name, run.id);
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const trace: TraceStep[] = [];
  let degraded = false;

  const ctx: AgentContext = {
    db,
    userId,
    runId: run.id,
    agent: def.name,
    llm,
    world: () => toolCtx.world(),
    trace,
    async tool(name, input) {
      const t0 = performance.now();
      const res = await executeTool(toolCtx, name, input, def.tools);
      trace.push({ kind: "tool", name, status: res.status, ms: Math.round(performance.now() - t0), detail: res.status === "error" || res.status === "denied" ? res.error : undefined });
      return res as never;
    },
    async need(name, input) {
      const res = await ctx.tool(name, input);
      if (res.status !== "ok") throw new Error(`${name}: ${"error" in res ? res.error : res.status}`);
      return res.output as never;
    },
    async llmStructured(req) {
      if (!llm) return null;
      const t0 = performance.now();
      try {
        const { data, usage: u } = await llm.structured(req);
        usage.inputTokens += u.inputTokens;
        usage.outputTokens += u.outputTokens;
        usage.costUsd += u.costUsd;
        trace.push({ kind: "llm", name: `${u.engine}:${u.model}`, status: "ok", ms: u.latencyMs, detail: `${u.inputTokens}→${u.outputTokens} tokens` });
        return data;
      } catch (err) {
        degraded = true;
        const msg = err instanceof LLMError ? err.message : String(err);
        trace.push({ kind: "llm", name: llm.model, status: "error", ms: Math.round(performance.now() - t0), detail: msg });
        logger.warn("agent.llm_failed_fallback", { agent: def.name, error: msg });
        return null; // callers fall back to the deterministic path
      }
    },
    note(text) {
      trace.push({ kind: "note", name: "note", status: "info", detail: text });
    },
  };

  try {
    const input = def.input.parse(rawInput);
    const output = await def.run(ctx, input);
    const validated = (def.output ?? AgentOutputSchema).parse(output) as O;
    const latencyMs = Math.round(performance.now() - started);
    const status = degraded ? "partial" : "ok";
    await db
      .update(s.aiRuns)
      .set({ output: { summary: validated.summary, blockTypes: validated.blocks.map((b) => b.type), trace } as object, status, latencyMs, ...usage })
      .where(eq(s.aiRuns.id, run.id));
    return { runId: run.id, output: validated, status, engine: llm?.engine ?? "local", model: llm?.model ?? null, latencyMs, usage, trace };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const message = err instanceof z.ZodError ? `Validation failed: ${err.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` : err instanceof Error ? err.message : String(err);
    logger.error("agent.failed", err, { agent: def.name, runId: run.id });
    await db.update(s.aiRuns).set({ status: "error", error: message, latencyMs, output: { trace } as object, ...usage }).where(eq(s.aiRuns.id, run.id));
    return {
      runId: run.id,
      output: { summary: `${def.name} could not complete: ${message}`, blocks: [{ type: "text", title: "Something went wrong", body: message }] } as unknown as O,
      status: "error",
      engine: llm?.engine ?? "local",
      model: llm?.model ?? null,
      latencyMs,
      usage,
      trace,
      error: message,
    };
  }
}

/** Grounded narration: the LLM may only restate the supplied facts. Falls back to the given text. */
export async function narrate(ctx: AgentContext, task: string, facts: unknown, fallback: string): Promise<string> {
  if (!ctx.llm) return fallback;
  const out = await ctx.llmStructured({
    system:
      "You are the narration layer of LIFEOS, a personal decision and opportunity operating system. Write in second person, plain British English, 1–3 sentences. Use ONLY the facts in the provided JSON — never invent numbers, names, dates or outcomes. Do not tell the user what to choose; explain what the data shows. If facts are thin, say so.",
    prompt: `Task: ${task}\n\nFACTS (JSON):\n${JSON.stringify(facts).slice(0, 12000)}`,
    schema: z.object({ summary: z.string() }),
    maxTokens: 1200,
  });
  return out?.summary?.trim() || fallback;
}
