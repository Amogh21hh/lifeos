import { z } from "zod";
import { api } from "@/server/security/api";
import { runAgent } from "@/server/agents/base";
import { DecisionAgent } from "@/server/agents/agents";

export const maxDuration = 120;

/** Frame a new decision via the DecisionAgent (logged in AI activity). */
export const POST = api({ limit: "ai", body: z.object({ question: z.string().trim().min(5).max(400) }) }, async ({ db, user, body }) => {
  const run = await runAgent(db, user.id, DecisionAgent, { question: body.question }, { intent: "decision" });
  const block = run.output.blocks.find((b) => b.type === "decision") as { decisionId: string } | undefined;
  return { decisionId: block?.decisionId ?? null, summary: run.output.summary, status: run.status, error: run.error };
});
