import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api } from "@/server/security/api";
import { loadWorld } from "@/server/engine/world";
import { classifyScenario, simulate } from "@/server/engine/simulate";
import { runAgent } from "@/server/agents/base";
import { FinanceAgent, PlannerAgent } from "@/server/agents/agents";
import type { SimulationResult } from "@/lib/types";

/**
 * save=true  → runs through the Planner/Finance agent (logged in AI activity) and stores the result.
 * save=false → deterministic re-computation for interactive assumption sliders (no AI involved).
 */
export const POST = api(
  { limit: "api", body: z.object({ question: z.string().trim().min(3).max(500), overrides: z.record(z.string(), z.number().finite()).default({}), save: z.boolean().default(true) }) },
  async ({ db, user, body }) => {
    if (!body.save) return { result: simulate(await loadWorld(db, user.id), body.question, body.overrides) };
    const money = ["spend", "income_change"].includes(classifyScenario(body.question));
    const run = await runAgent(db, user.id, (money ? FinanceAgent : PlannerAgent) as never, { op: "simulate", question: body.question, overrides: body.overrides }, { intent: "simulate" });
    const block = (run.output as { blocks: { type: string; result?: SimulationResult }[] }).blocks.find((b) => b.type === "simulation");
    const result = block?.result ?? simulate(await loadWorld(db, user.id), body.question, body.overrides);
    const [row] = await db.insert(s.simulations).values({ userId: user.id, question: body.question, scenario: { overrides: body.overrides, type: result.scenarioType }, result: result as unknown as Record<string, unknown> }).returning({ id: s.simulations.id });
    return { result: { ...result, id: row.id }, runId: run.runId };
  },
);

export const DELETE = api({}, async ({ db, user, req }) => {
  const id = z.string().uuid().parse(req.nextUrl.searchParams.get("id"));
  await db.delete(s.simulations).where(and(eq(s.simulations.id, id), eq(s.simulations.userId, user.id)));
  return { ok: true };
});
