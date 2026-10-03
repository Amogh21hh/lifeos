import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api, ApiError } from "@/server/security/api";
import { indexEntities } from "@/server/search/indexer";
import type { DB } from "@/server/db/client";

const score = z.number().min(0).max(10);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("weights"), criteria: z.array(z.object({ id: z.string().uuid(), weight: z.number().min(0).max(1) })).max(20) }),
  z.object({ action: z.literal("score"), optionId: z.string().uuid(), criterionId: z.string().uuid(), score, low: score.optional(), high: score.optional(), rationale: z.string().max(300).optional() }),
  z.object({ action: z.literal("add_option"), label: z.string().trim().min(1).max(160), upfrontCost: z.number().min(0).optional(), monthlyCost: z.number().min(0).optional() }),
  z.object({ action: z.literal("add_criterion"), name: z.string().trim().min(1).max(80), weight: z.number().min(0).max(1) }),
  z.object({ action: z.literal("remove_option"), optionId: z.string().uuid() }),
  z.object({ action: z.literal("remove_criterion"), criterionId: z.string().uuid() }),
  z.object({ action: z.literal("add_unknown"), question: z.string().trim().min(3).max(300), impact: z.enum(["low", "medium", "high"]) }),
  z.object({ action: z.literal("decide"), optionId: z.string().uuid(), reviewOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), rationale: z.string().max(2000).optional() }),
  z.object({ action: z.literal("outcome"), outcome: z.string().max(2000), lessons: z.string().max(2000).optional() }),
  z.object({ action: z.literal("reopen") }),
]);

async function own(db: DB, userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid id");
  const [d] = await db.select().from(s.decisions).where(and(eq(s.decisions.id, id), eq(s.decisions.userId, userId)));
  if (!d) throw new ApiError(404, "Decision not found");
  return d;
}

export const PATCH = api({ body: Body }, async ({ db, user, params, body }) => {
  const d = await own(db, user.id, params.id);
  const options = await db.select({ id: s.decisionOptions.id }).from(s.decisionOptions).where(eq(s.decisionOptions.decisionId, d.id));
  const criteria = await db.select({ id: s.decisionCriteria.id }).from(s.decisionCriteria).where(eq(s.decisionCriteria.decisionId, d.id));
  const optIds = new Set(options.map((o) => o.id));
  const critIds = new Set(criteria.map((c) => c.id));
  switch (body.action) {
    case "weights":
      for (const c of body.criteria) if (critIds.has(c.id)) await db.update(s.decisionCriteria).set({ weight: c.weight }).where(eq(s.decisionCriteria.id, c.id));
      break;
    case "score": {
      if (!optIds.has(body.optionId) || !critIds.has(body.criterionId)) throw new ApiError(400, "Option/criterion not in this decision");
      const low = Math.min(body.low ?? body.score, body.score);
      const high = Math.max(body.high ?? body.score, body.score);
      await db
        .insert(s.decisionScores)
        .values({ optionId: body.optionId, criterionId: body.criterionId, score: body.score, low, high, rationale: body.rationale, provenance: "user_input" })
        .onConflictDoUpdate({ target: [s.decisionScores.optionId, s.decisionScores.criterionId], set: { score: body.score, low, high, provenance: "user_input", ...(body.rationale ? { rationale: body.rationale } : {}) } });
      break;
    }
    case "add_option": {
      const [o] = await db.insert(s.decisionOptions).values({ decisionId: d.id, label: body.label, upfrontCost: body.upfrontCost, monthlyCost: body.monthlyCost, position: options.length }).returning();
      if (criteria.length) await db.insert(s.decisionScores).values(criteria.map((c) => ({ optionId: o.id, criterionId: c.id, score: 5, low: 3, high: 7, provenance: "assumption", rationale: "Neutral placeholder — score it" })));
      break;
    }
    case "add_criterion": {
      const [c] = await db.insert(s.decisionCriteria).values({ decisionId: d.id, name: body.name, weight: body.weight }).returning();
      if (options.length) await db.insert(s.decisionScores).values(options.map((o) => ({ optionId: o.id, criterionId: c.id, score: 5, low: 3, high: 7, provenance: "assumption", rationale: "Neutral placeholder — score it" })));
      break;
    }
    case "remove_option":
      if (options.length <= 2) throw new ApiError(400, "A decision needs at least two options");
      await db.delete(s.decisionOptions).where(and(eq(s.decisionOptions.id, body.optionId), inArray(s.decisionOptions.id, [...optIds])));
      break;
    case "remove_criterion":
      if (criteria.length <= 1) throw new ApiError(400, "A decision needs at least one criterion");
      await db.delete(s.decisionCriteria).where(and(eq(s.decisionCriteria.id, body.criterionId), inArray(s.decisionCriteria.id, [...critIds])));
      break;
    case "add_unknown":
      await db.update(s.decisions).set({ model: { ...d.model, unknowns: [...(d.model.unknowns ?? []), { question: body.question, impact: body.impact }] }, updatedAt: new Date() }).where(eq(s.decisions.id, d.id));
      break;
    case "decide":
      if (!optIds.has(body.optionId)) throw new ApiError(400, "Option not in this decision");
      await db.update(s.decisions).set({ status: "decided", chosenOptionId: body.optionId, decidedAt: new Date(), reviewOn: body.reviewOn ?? null, context: body.rationale ? `${d.context ?? ""}\n\nDecision rationale: ${body.rationale}`.trim() : d.context, updatedAt: new Date() }).where(eq(s.decisions.id, d.id));
      await db.insert(s.activities).values({ userId: user.id, entityType: "decision", entityId: d.id, action: "decided", summary: `Decided: ${d.title}` });
      break;
    case "outcome":
      await db.update(s.decisions).set({ outcome: body.outcome, lessons: body.lessons ?? d.lessons, updatedAt: new Date() }).where(eq(s.decisions.id, d.id));
      if (body.lessons) await db.insert(s.memories).values({ userId: user.id, content: body.lessons, category: "lesson", source: "decision", sourceRefType: "decision", sourceRefId: d.id, confidence: 0.9, importance: 3, lastVerifiedAt: new Date() });
      break;
    case "reopen":
      await db.update(s.decisions).set({ status: "open", chosenOptionId: null, decidedAt: null, updatedAt: new Date() }).where(eq(s.decisions.id, d.id));
      break;
  }
  await db.update(s.decisions).set({ updatedAt: new Date() }).where(eq(s.decisions.id, d.id));
  await indexEntities(db, user.id, "decision", [d.id]);
  return { ok: true };
});
