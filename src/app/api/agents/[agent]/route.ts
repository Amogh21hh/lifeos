import { z } from "zod";
import { api, ApiError } from "@/server/security/api";
import { runAgent } from "@/server/agents/base";
import { AGENTS } from "@/server/agents/agents";

export const maxDuration = 120;

/**
 * Direct agent invocation from UI buttons (e.g. "Move this project forward", "Run radar").
 * The agent validates its own input schema; only agents in the registry are reachable.
 */
export const POST = api({ limit: "ai", body: z.record(z.string(), z.unknown()) }, async ({ db, user, params, body }) => {
  const agent = AGENTS[params.agent as keyof typeof AGENTS];
  if (!agent) throw new ApiError(404, "Unknown agent");
  const run = await runAgent(db, user.id, agent as never, body, { intent: `ui:${params.agent}` });
  return { runId: run.runId, status: run.status, ...(run.output as object), trace: run.trace, latencyMs: run.latencyMs, engine: run.engine };
});
