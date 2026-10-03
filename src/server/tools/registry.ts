/**
 * Tool registry.
 *
 * Every capability an agent can use is a Tool with: name, description, Zod input/output schemas,
 * a permission level, and audit logging. Permission levels:
 *
 *   read         – reads the user's own data. Executes immediately.
 *   write        – creates/changes records. Queued for approval unless `autoApprove` (derived,
 *                  low-risk artefacts such as a generated report or a requested decision workspace).
 *   external     – leaves the system (send a message, query a web provider). Always needs approval.
 *   destructive  – deletes data. Always needs approval, flagged high risk.
 *
 * PROPOSE → EXPLAIN → ASK USER → EXECUTE is enforced here, not in the agents, so no agent can
 * bypass it.
 */
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { loadWorld, type World } from "@/server/engine/world";
import { logger } from "@/server/observability/logger";

export type Permission = "read" | "write" | "external" | "destructive";

export interface ToolContext {
  db: DB;
  userId: string;
  runId: string | null;
  agent: string;
  /** Lazily loaded and cached world snapshot. Call invalidate() after writes. */
  world(): Promise<World>;
  invalidate(): void;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  permission: Permission;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  autoApprove?: boolean;
  risk?: "low" | "medium" | "high";
  /** Human-readable proposal used in the approval queue. */
  propose?: (input: I, ctx: ToolContext) => Promise<{ title: string; explanation: string }> | { title: string; explanation: string };
  handler: (ctx: ToolContext, input: I) => Promise<O>;
  summarize?: (output: O) => string;
  entities?: (input: I, output: O) => string[];
}

const registry = new Map<string, ToolDefinition<never, never>>();

export function defineTool<I, O>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  registry.set(def.name, def as unknown as ToolDefinition<never, never>);
  return def;
}

export function getTool(name: string) {
  return registry.get(name) as ToolDefinition<unknown, unknown> | undefined;
}

export function listTools() {
  return [...registry.values()].map((t) => ({
    name: t.name,
    description: t.description,
    permission: t.permission,
    autoApprove: !!t.autoApprove,
    risk: t.risk ?? (t.permission === "destructive" ? "high" : t.permission === "external" ? "medium" : "low"),
    input: z.toJSONSchema(t.input as z.ZodType, { unrepresentable: "any" }),
    output: z.toJSONSchema(t.output as z.ZodType, { unrepresentable: "any" }),
  }));
}

export type ToolResult<O> =
  | { status: "ok"; output: O; callId: string }
  | { status: "pending_approval"; approvalId: string; title: string; explanation: string; risk: string; callId: string }
  | { status: "denied" | "error"; error: string; callId: string };

export function makeToolContext(db: DB, userId: string, agent: string, runId: string | null): ToolContext {
  let cached: Promise<World> | null = null;
  return {
    db,
    userId,
    runId,
    agent,
    world: () => (cached ??= loadWorld(db, userId)),
    invalidate: () => {
      cached = null;
    },
  };
}

function needsApproval(t: ToolDefinition<unknown, unknown>) {
  if (t.permission === "read") return false;
  if (t.permission === "write" && t.autoApprove) return false;
  return true;
}

async function logCall(ctx: ToolContext, t: ToolDefinition<unknown, unknown>, input: unknown, status: string, extra: { outputSummary?: string; error?: string; latencyMs?: number; entities?: string[] }) {
  try {
    const [row] = await ctx.db
      .insert(s.toolCalls)
      .values({
        userId: ctx.userId,
        runId: ctx.runId,
        agent: ctx.agent,
        tool: t.name,
        permission: t.permission,
        input: input as object,
        outputSummary: extra.outputSummary?.slice(0, 500),
        entitiesAccessed: extra.entities ?? [],
        status,
        error: extra.error,
        latencyMs: extra.latencyMs,
      })
      .returning({ id: s.toolCalls.id });
    return row.id;
  } catch (err) {
    logger.error("tool.audit_failed", err, { tool: t.name });
    return "unlogged";
  }
}

/**
 * Execute a tool on behalf of an agent.
 * @param allowed the calling agent's tool allowlist (enforced here)
 */
export async function executeTool<O = unknown>(ctx: ToolContext, name: string, rawInput: unknown, allowed: string[] | "*", opts: { approved?: boolean } = {}): Promise<ToolResult<O>> {
  const t = getTool(name);
  if (!t) return { status: "error", error: `Unknown tool: ${name}`, callId: "none" };
  if (allowed !== "*" && !allowed.includes(name)) {
    const callId = await logCall(ctx, t, rawInput, "denied", { error: `Agent ${ctx.agent} is not permitted to use ${name}` });
    logger.warn("tool.denied", { tool: name, agent: ctx.agent });
    return { status: "denied", error: `Agent ${ctx.agent} is not permitted to use ${name}`, callId };
  }
  const parsed = t.input.safeParse(rawInput);
  if (!parsed.success) {
    const error = `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`;
    const callId = await logCall(ctx, t, rawInput, "error", { error });
    return { status: "error", error, callId };
  }

  if (needsApproval(t) && !opts.approved) {
    const proposal = t.propose ? await t.propose(parsed.data as never, ctx) : { title: `${t.name}`, explanation: t.description };
    const risk = t.risk ?? (t.permission === "destructive" ? "high" : t.permission === "external" ? "medium" : "low");
    const [approval] = await ctx.db
      .insert(s.approvals)
      .values({ userId: ctx.userId, runId: ctx.runId, agent: ctx.agent, tool: t.name, title: proposal.title, explanation: proposal.explanation, risk, payload: parsed.data as Record<string, unknown> })
      .returning();
    const callId = await logCall(ctx, t, parsed.data, "pending_approval", { outputSummary: proposal.title });
    return { status: "pending_approval", approvalId: approval.id, title: proposal.title, explanation: proposal.explanation, risk, callId };
  }

  const started = performance.now();
  try {
    const output = await t.handler(ctx, parsed.data as never);
    const check = t.output.safeParse(output);
    if (!check.success) logger.warn("tool.output_schema_mismatch", { tool: name, issues: check.error.issues.slice(0, 3).map((i) => i.message) });
    if (t.permission !== "read") ctx.invalidate();
    const latencyMs = Math.round(performance.now() - started);
    const callId = await logCall(ctx, t, parsed.data, "ok", {
      outputSummary: t.summarize ? t.summarize(output as never) : undefined,
      latencyMs,
      entities: t.entities ? t.entities(parsed.data as never, output as never) : [],
    });
    return { status: "ok", output: output as O, callId };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - started);
    const error = err instanceof Error ? err.message : String(err);
    logger.error("tool.failed", err, { tool: name });
    const callId = await logCall(ctx, t, parsed.data, "error", { error, latencyMs });
    return { status: "error", error, callId };
  }
}

/** User approved a queued action: execute it exactly as proposed. */
export async function resolveApproval(db: DB, userId: string, approvalId: string, decision: "approve" | "reject") {
  const [a] = await db.select().from(s.approvals).where(and(eq(s.approvals.id, approvalId), eq(s.approvals.userId, userId)));
  if (!a) throw new Error("Approval not found");
  if (a.status !== "pending") throw new Error(`Approval already ${a.status}`);
  if (decision === "reject") {
    await db.update(s.approvals).set({ status: "rejected", decidedAt: new Date() }).where(eq(s.approvals.id, a.id));
    return { status: "rejected" as const };
  }
  await db.update(s.approvals).set({ status: "approved", decidedAt: new Date() }).where(eq(s.approvals.id, a.id));
  const ctx = makeToolContext(db, userId, a.agent ?? "user", a.runId);
  const result = await executeTool(ctx, a.tool, a.payload, "*", { approved: true });
  const status = result.status === "ok" ? "executed" : "failed";
  await db
    .update(s.approvals)
    .set({ status, result: result.status === "ok" ? (result.output as object) : { error: "error" in result ? result.error : "unknown" } })
    .where(eq(s.approvals.id, a.id));
  return { status, result };
}
