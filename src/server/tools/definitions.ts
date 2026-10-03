/**
 * Concrete tools. Read tools wrap the deterministic engines; write/external/destructive tools
 * mutate state and therefore pass through the approval queue (see registry.ts).
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { cosine, localEmbed } from "@/server/ai/embeddings";
import { rankActions } from "@/server/engine/actions";
import { moveProjectForward } from "@/server/engine/autopilot";
import { analyzeDecision, draftDecision } from "@/server/engine/decision";
import { whatAmIMissing } from "@/server/engine/missing";
import { nextActionFor, opportunityRadar } from "@/server/engine/radar";
import { financeSummary, isOpenOpp, opportunityFit, projectProgress } from "@/server/engine/signals";
import { simulate } from "@/server/engine/simulate";
import { weeklyReport, whatChanged } from "@/server/engine/weekly";
import { refOf } from "@/server/engine/world";
import { messagingFor, webSearchProvider } from "@/server/integrations";
import { hybridSearch, neighbours } from "@/server/search/search";
import { indexEntities, removeFromIndex } from "@/server/search/indexer";
import { daysUntil, money } from "@/lib/format";
import type { EntityType } from "@/lib/types";
import { defineTool } from "./registry";

const anyOut = z.any();
const uuid = z.string().uuid();
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/* ═════════════════════════════ READ ═════════════════════════════ */

defineTool({
  name: "search_everything",
  description: "Hybrid keyword + semantic + metadata + graph search across all of the user's records.",
  permission: "read",
  input: z.object({ query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).optional() }),
  output: anyOut,
  async handler(ctx, { query, limit }) {
    return hybridSearch(ctx.db, await ctx.world(), query, { limit });
  },
  summarize: (o: { results: unknown[] }) => `${o.results.length} results`,
  entities: (_i, o: { results: { ref: { type: string; id: string } }[] }) => o.results.slice(0, 20).map((r) => `${r.ref.type}:${r.ref.id}`),
});

defineTool({
  name: "search_documents",
  description: "Search uploaded documents and their extracted fields.",
  permission: "read",
  input: z.object({ query: z.string().min(1).max(500) }),
  output: anyOut,
  async handler(ctx, { query }) {
    const res = await hybridSearch(ctx.db, await ctx.world(), `${query} documents`, { limit: 15 });
    return { ...res, results: res.results.filter((r) => r.ref.type === "document") };
  },
  summarize: (o: { results: unknown[] }) => `${o.results.length} documents`,
});

defineTool({
  name: "search_memory",
  description: "Find long-term memories (preferences, facts, lessons, constraints) relevant to a query, with provenance.",
  permission: "read",
  input: z.object({ query: z.string().max(500).default(""), includeArchived: z.boolean().default(false) }),
  output: z.array(z.object({ id: z.string(), content: z.string(), category: z.string(), source: z.string(), confidence: z.number(), similarity: z.number() })),
  async handler(ctx, { query, includeArchived }) {
    const w = await ctx.world();
    const qv = localEmbed(query);
    return w.memories
      .filter((m) => includeArchived || m.status === "active")
      .map((m) => ({ id: m.id, content: m.content, category: m.category, source: m.source, confidence: m.confidence, similarity: query ? cosine(qv, localEmbed(m.content)) : m.importance / 5 }))
      .filter((m) => !query || m.similarity > 0.05)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 12);
  },
  summarize: (o: unknown[]) => `${o.length} memories`,
  entities: (_i, o: { id: string }[]) => o.map((m) => `memory:${m.id}`),
});

defineTool({
  name: "get_project",
  description: "Get a project with progress, open tasks, blockers and links. Accepts id or a name fragment.",
  permission: "read",
  input: z.object({ projectId: uuid.optional(), name: z.string().optional() }).refine((v) => v.projectId || v.name, "projectId or name required"),
  output: anyOut,
  async handler(ctx, { projectId, name }) {
    const w = await ctx.world();
    const p = projectId ? w.idx.project.get(projectId) : w.projects.find((x) => x.title.toLowerCase().includes(name!.toLowerCase()));
    if (!p) throw new Error("Project not found");
    const prog = projectProgress(w, p.id);
    return { project: p, progress: prog.pct, open: prog.remaining.map((t) => ({ id: t.id, title: t.title, status: t.status, due: t.dueDate, minutes: t.estimateMinutes })), blocked: prog.blocked.map((t) => t.title) };
  },
  entities: (_i, o: { project: { id: string } }) => [`project:${o.project.id}`],
});

defineTool({
  name: "list_projects",
  description: "List projects with progress; optionally only unfinished or stalled ones.",
  permission: "read",
  input: z.object({ filter: z.enum(["all", "unfinished", "stalled"]).default("unfinished") }),
  output: anyOut,
  async handler(ctx, { filter }) {
    const w = await ctx.world();
    return w.projects
      .filter((p) => filter === "all" || p.status !== "done")
      .map((p) => {
        const prog = projectProgress(w, p.id);
        const idle = p.lastActivityAt ? Math.round((w.now.getTime() - p.lastActivityAt.getTime()) / 86_400_000) : 999;
        return { id: p.id, title: p.title, status: p.status, progress: prog.pct, openTasks: prog.remaining.length, idleDays: idle, due: p.dueDate };
      })
      .filter((p) => filter !== "stalled" || p.idleDays >= 7)
      .sort((a, b) => b.progress - a.progress);
  },
});

defineTool({
  name: "get_goal",
  description: "Get a goal with its projects and recent activity. Accepts id or name fragment.",
  permission: "read",
  input: z.object({ goalId: uuid.optional(), name: z.string().optional() }),
  output: anyOut,
  async handler(ctx, { goalId, name }) {
    const w = await ctx.world();
    const g = goalId ? w.idx.goal.get(goalId) : w.goals.find((x) => x.title.toLowerCase().includes((name ?? "").toLowerCase()));
    if (!g) throw new Error("Goal not found");
    return { goal: g, projects: w.projects.filter((p) => p.goalId === g.id).map((p) => ({ id: p.id, title: p.title, progress: projectProgress(w, p.id).pct })) };
  },
});

defineTool({
  name: "find_deadlines",
  description: "All dated obligations (tasks, opportunities, commitments, document deadlines, events) in a window.",
  permission: "read",
  input: z.object({ days: z.number().int().min(1).max(365).default(14), includeOverdue: z.boolean().default(true) }),
  output: anyOut,
  async handler(ctx, { days, includeOverdue }) {
    const w = await ctx.world();
    const out: { label: string; date: string; days: number; type: EntityType; id: string; source: string }[] = [];
    const add = (label: string, date: string | null, type: EntityType, id: string, source: string) => {
      const d = daysUntil(date, w.now);
      if (date && d !== null && d <= days && (includeOverdue || d >= 0)) out.push({ label, date, days: d, type, id, source });
    };
    w.tasks.filter((t) => !["done", "cancelled"].includes(t.status)).forEach((t) => add(t.title, t.dueDate, "task", t.id, "task"));
    w.opportunities.filter(isOpenOpp).forEach((o) => add(`${o.title} deadline`, o.deadline, "opportunity", o.id, "opportunity"));
    w.commitments.filter((c) => c.status === "open").forEach((c) => add(c.title, c.dueDate, "commitment", c.id, "commitment"));
    w.documentFields.filter((f) => f.valueType === "date" && /due|deadline|notice|reply|expiry|exam/.test(f.key)).forEach((f) => add(`${f.label} (${w.idx.document.get(f.documentId)?.title})`, f.value, "document", f.documentId, "document"));
    w.events.forEach((e) => add(e.title, e.startsAt.toISOString().slice(0, 10), "event", e.id, e.kind));
    return out.filter((d) => d.days >= -30).sort((a, b) => a.days - b.days);
  },
  summarize: (o: unknown[]) => `${o.length} deadlines`,
});

defineTool({
  name: "find_relationships",
  description: "Explore the knowledge graph around an entity (people, companies, projects, skills…).",
  permission: "read",
  input: z.object({ type: z.string(), id: uuid }),
  output: anyOut,
  async handler(ctx, { type, id }) {
    const w = await ctx.world();
    return [...neighbours(w, type, id).entries()].map(([key, v]) => {
      const [t, i] = key.split(":");
      return { ...refOf(w, t as EntityType, i), hop: v.hop, via: v.via };
    });
  },
});

defineTool({
  name: "analyze_document",
  description: "Return a document's classification, summary and extracted fields with source spans.",
  permission: "read",
  input: z.object({ documentId: uuid }),
  output: anyOut,
  async handler(ctx, { documentId }) {
    const w = await ctx.world();
    const d = w.idx.document.get(documentId);
    if (!d) throw new Error("Document not found");
    return { document: d, fields: w.documentFields.filter((f) => f.documentId === documentId) };
  },
  entities: (i) => [`document:${i.documentId}`],
});

defineTool({
  name: "rank_actions",
  description: "Rank candidate next actions by leverage (impact × urgency × confidence ÷ effort) with explanations.",
  permission: "read",
  input: z.object({ limit: z.number().int().min(1).max(20).default(7) }),
  output: anyOut,
  async handler(ctx, { limit }) {
    return rankActions(await ctx.world()).slice(0, limit);
  },
  summarize: (o: unknown[]) => `${o.length} actions ranked`,
});

defineTool({
  name: "what_am_i_missing",
  description: "Run all blind-spot detectors. Every insight cites evidence.",
  permission: "read",
  input: z.object({}),
  output: anyOut,
  async handler(ctx) {
    return whatAmIMissing(await ctx.world());
  },
  summarize: (o: unknown[]) => `${o.length} blind spots`,
});

defineTool({
  name: "what_changed",
  description: "Changes (new items, status changes, completions, messages) within the last N days.",
  permission: "read",
  input: z.object({ days: z.number().int().min(1).max(90).default(7) }),
  output: anyOut,
  async handler(ctx, { days }) {
    return whatChanged(await ctx.world(), days);
  },
});

defineTool({
  name: "weekly_review",
  description: "Compute the weekly intelligence report.",
  permission: "read",
  input: z.object({}),
  output: anyOut,
  async handler(ctx) {
    return weeklyReport(await ctx.world());
  },
});

defineTool({
  name: "calculate_scenario",
  description: "Run a transparent what-if simulation (extra hours, stop project, spend/earn, delay, learn skill).",
  permission: "read",
  input: z.object({ question: z.string().min(3).max(500), overrides: z.record(z.string(), z.number()).default({}) }),
  output: anyOut,
  async handler(ctx, { question, overrides }) {
    return simulate(await ctx.world(), question, overrides);
  },
  summarize: (o: { headline: string }) => o.headline,
});

defineTool({
  name: "opportunity_radar",
  description: "Rank routes (existing + inferred opportunities) towards a stated objective with labelled estimates.",
  permission: "read",
  input: z.object({ objective: z.string().min(3).max(300) }),
  output: anyOut,
  async handler(ctx, { objective }) {
    return opportunityRadar(await ctx.world(), objective);
  },
  summarize: (o: { routes: unknown[] }) => `${o.routes.length} routes`,
});

defineTool({
  name: "analyze_opportunity",
  description: "Fit analysis for one opportunity: skills matched/missing, contacts, visa, next action.",
  permission: "read",
  input: z.object({ opportunityId: uuid.optional(), name: z.string().optional() }),
  output: anyOut,
  async handler(ctx, { opportunityId, name }) {
    const w = await ctx.world();
    const q = (name ?? "").toLowerCase();
    // Prefer open opportunities; then exact containment; then semantic similarity.
    const pool = [...w.opportunities].sort((a, b) => Number(isOpenOpp(b)) - Number(isOpenOpp(a)));
    const words = q.split(/[^a-z0-9&]+/).filter((x) => x.length > 2);
    const o = opportunityId
      ? w.idx.opportunity.get(opportunityId)
      : (pool.find((x) => q && x.title.toLowerCase().includes(q)) ??
        pool.find((x) => words.length > 0 && words.every((wd) => x.title.toLowerCase().includes(wd))) ??
        [...pool].sort((a, b) => cosine(localEmbed(q), localEmbed(b.title)) - cosine(localEmbed(q), localEmbed(a.title)))[0]);
    if (!o) throw new Error("Opportunity not found");
    return { opportunity: o, fit: opportunityFit(w, o.id), nextAction: nextActionFor(w, o.id), company: o.companyId ? w.idx.company.get(o.companyId) : null };
  },
  entities: (_i, o: { opportunity: { id: string } }) => [`opportunity:${o.opportunity.id}`],
});

defineTool({
  name: "move_project_forward",
  description: "Inspect a project's state and produce a concrete execution plan starting with the smallest useful next action.",
  permission: "read",
  input: z.object({ projectId: uuid }),
  output: anyOut,
  async handler(ctx, { projectId }) {
    return moveProjectForward(await ctx.world(), projectId);
  },
  entities: (i) => [`project:${i.projectId}`],
});

defineTool({
  name: "analyze_decision",
  description: "Scenario, sensitivity and missing-information analysis for a decision.",
  permission: "read",
  input: z.object({ decisionId: uuid }),
  output: anyOut,
  async handler(ctx, { decisionId }) {
    const w = await ctx.world();
    const decision = w.idx.decision.get(decisionId);
    if (!decision) throw new Error("Decision not found");
    const options = w.decisionOptions.filter((o) => o.decisionId === decisionId).sort((a, b) => a.position - b.position);
    const criteria = w.decisionCriteria.filter((c) => c.decisionId === decisionId);
    const scores = w.decisionScores.filter((sc) => options.some((o) => o.id === sc.optionId));
    return analyzeDecision(w, { decision, options, criteria, scores });
  },
});

defineTool({
  name: "finance_overview",
  description: "Cash, runway, monthly income/expenses, categories and recurring costs.",
  permission: "read",
  input: z.object({ windowDays: z.number().int().min(30).max(365).default(90) }),
  output: anyOut,
  async handler(ctx, { windowDays }) {
    return financeSummary(await ctx.world(), windowDays);
  },
});

defineTool({
  name: "draft_message",
  description: "Draft (but do not send) a message to a person, grounded in recorded context.",
  permission: "read",
  input: z.object({ personId: uuid, purpose: z.string().max(300) }),
  output: z.object({ to: z.string(), channel: z.string(), subject: z.string(), body: z.string(), grounding: z.array(z.string()) }),
  async handler(ctx, { personId, purpose }) {
    const w = await ctx.world();
    const p = w.idx.person.get(personId);
    if (!p) throw new Error("Person not found");
    const last = [...w.messages].filter((m) => m.personId === p.id).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())[0];
    const opp = last?.opportunityId ? w.idx.opportunity.get(last.opportunityId) : w.opportunities.find((o) => o.contactPersonId === p.id && isOpenOpp(o));
    const first = p.name.split(" ")[0];
    const grounding: string[] = [];
    let body: string;
    let subject = last?.subject ? `Re: ${last.subject.replace(/^Re:\s*/i, "")}` : purpose;
    if (/follow/i.test(purpose) && opp) {
      body = `Hi ${first},\n\nI hope you're well. I applied for the ${opp.title} role and wanted to reiterate my interest — my recent work on credit and valuation modelling maps closely to what the team does.\n\nIs there anything else I can share to help the process?\n\nBest regards,\n${w.user.name}`;
      grounding.push(`Application: ${opp.title}`);
    } else if (opp && last?.direction === "in" && /interview|confirm/i.test(last.body ?? "")) {
      body = `Hi ${first},\n\nThank you for the invitation — I'm pleased to confirm my attendance${w.events.find((e) => e.opportunityId === opp.id && e.startsAt > w.now) ? ` on ${w.events.find((e) => e.opportunityId === opp.id && e.startsAt > w.now)!.startsAt.toUTCString().slice(0, 16)}` : ""}. I'm looking forward to the case study.\n\nBest regards,\n${w.user.name}`;
      grounding.push(`Their message: “${last.body?.slice(0, 80)}”`);
    } else if (opp && last?.direction === "in") {
      body = `Hi ${first},\n\nThank you for reaching out about the ${opp.title.split("—")[0].trim()} role — it's exactly the kind of position I'm targeting.${opp.deadline ? ` I'll make sure my application is in before the deadline.` : ""} I'd be glad to have a quick call; I'm free most afternoons this week.\n\nBest regards,\n${w.user.name}`;
      grounding.push(`Their message ${last.occurredAt.toISOString().slice(0, 10)}: “${last.body?.slice(0, 80)}”`);
      if (opp.deadline) grounding.push(`Deadline ${opp.deadline}`);
    } else if (last?.direction === "in") {
      body = `Hi ${first},\n\nThanks for your message — ${/monthly|accounts/i.test(last.body ?? "") ? "I'd be happy to take on your monthly management accounts. I'll send a short proposal with scope and a fixed monthly fee by the end of the week." : "sorry for the slow reply. " + purpose}\n\nBest,\n${w.user.name}`;
      grounding.push(`Their message: “${last.body?.slice(0, 80)}”`);
    } else {
      subject = purpose;
      body = `Hi ${first},\n\nIt's been a while — I hope things are going well${p.companyId ? ` at ${w.idx.company.get(p.companyId)?.name}` : ""}. ${purpose}\n\nBest,\n${w.user.name}`;
      grounding.push(`Last contact: ${p.lastContactAt?.toISOString().slice(0, 10) ?? "unknown"}`);
    }
    return { to: p.name, channel: p.email ? "email" : (last?.channel ?? "linkedin"), subject, body, grounding };
  },
});

defineTool({
  name: "search_web",
  description: "Query an external web search provider. Sends the query outside LIFEOS, so it requires approval.",
  permission: "external",
  risk: "low",
  input: z.object({ query: z.string().min(2).max(300) }),
  output: anyOut,
  propose: ({ query }) => ({ title: `Search the web for “${query}”`, explanation: "This sends your query to an external search provider. No personal records are attached." }),
  async handler(_ctx, { query }) {
    return webSearchProvider().search(query);
  },
});

/* ═════════════════════════════ WRITE (approval) ═════════════════════════════ */

defineTool({
  name: "create_task",
  description: "Create a task (optionally in a project, with due date and estimate).",
  permission: "write",
  input: z.object({ title: z.string().min(2).max(200), projectId: uuid.optional(), goalId: uuid.optional(), dueDate: isoDay.optional(), estimateMinutes: z.number().int().min(1).max(2400).optional(), description: z.string().max(2000).optional() }),
  output: z.object({ id: z.string(), title: z.string() }),
  async propose(input, ctx) {
    const w = await ctx.world();
    return { title: `Create task: ${input.title}`, explanation: [input.projectId && `In project “${w.idx.project.get(input.projectId)?.title}”.`, input.dueDate && `Due ${input.dueDate}.`, input.estimateMinutes && `~${input.estimateMinutes} min.`].filter(Boolean).join(" ") || "Adds a new task to your list." };
  },
  async handler(ctx, input) {
    const [t] = await ctx.db.insert(s.tasks).values({ ...input, userId: ctx.userId, source: "ai" }).returning();
    await ctx.db.insert(s.activities).values({ userId: ctx.userId, entityType: "task", entityId: t.id, action: "created", summary: `Task created (approved AI proposal): ${t.title}`, goalId: input.goalId });
    await indexEntities(ctx.db, ctx.userId, "task", [t.id]);
    return { id: t.id, title: t.title };
  },
  entities: (_i, o) => [`task:${o.id}`],
});

defineTool({
  name: "update_task",
  description: "Update a task's status, due date or estimate.",
  permission: "write",
  input: z.object({ taskId: uuid, status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional(), dueDate: isoDay.nullable().optional(), estimateMinutes: z.number().int().min(1).max(2400).optional() }),
  output: z.object({ id: z.string(), status: z.string() }),
  async propose(input, ctx) {
    const t = (await ctx.world()).idx.task.get(input.taskId);
    return { title: `Update task “${t?.title}”`, explanation: Object.entries(input).filter(([k]) => k !== "taskId").map(([k, v]) => `${k} → ${v}`).join(", ") };
  },
  async handler(ctx, { taskId, ...patch }) {
    const [t] = await ctx.db
      .update(s.tasks)
      .set({ ...patch, updatedAt: new Date(), ...(patch.status === "done" ? { completedAt: new Date() } : {}) })
      .where(and(eq(s.tasks.id, taskId), eq(s.tasks.userId, ctx.userId)))
      .returning();
    if (!t) throw new Error("Task not found");
    await ctx.db.insert(s.activities).values({ userId: ctx.userId, entityType: "task", entityId: t.id, action: patch.status === "done" ? "completed" : "updated", summary: `Task updated: ${t.title}`, goalId: t.goalId });
    await indexEntities(ctx.db, ctx.userId, "task", [t.id]);
    return { id: t.id, status: t.status };
  },
});

defineTool({
  name: "create_opportunity",
  description: "Record a new opportunity.",
  permission: "write",
  input: z.object({ title: z.string().min(2).max(200), type: z.enum(["job", "internship", "freelance", "side_income", "course", "scholarship", "event", "networking", "investment", "grant"]), description: z.string().max(4000).optional(), deadline: isoDay.optional(), valueLow: z.number().optional(), valueHigh: z.number().optional(), valuePeriod: z.enum(["per_year", "per_month", "per_day", "one_off"]).optional(), sourceDocumentId: uuid.optional() }),
  output: z.object({ id: z.string(), title: z.string() }),
  propose: (i) => ({ title: `Add opportunity: ${i.title}`, explanation: `${i.type}${i.deadline ? `, deadline ${i.deadline}` : ""}${i.valueLow ? `, value ${money(i.valueLow)}${i.valueHigh ? `–${money(i.valueHigh)}` : ""}` : ""}.` }),
  async handler(ctx, input) {
    const [o] = await ctx.db.insert(s.opportunities).values({ ...input, userId: ctx.userId, source: input.sourceDocumentId ? "document" : "ai_inference" }).returning();
    await ctx.db.insert(s.activities).values({ userId: ctx.userId, entityType: "opportunity", entityId: o.id, action: "created", summary: `Opportunity added: ${o.title}` });
    await indexEntities(ctx.db, ctx.userId, "opportunity", [o.id]);
    return { id: o.id, title: o.title };
  },
});

defineTool({
  name: "create_decision",
  description: "Create a structured decision workspace from a question (options, weighted criteria, estimated scores, unknowns).",
  permission: "write",
  autoApprove: true,
  input: z.object({ question: z.string().min(5).max(400), draft: z.any().optional() }),
  output: z.object({ id: z.string(), title: z.string() }),
  async handler(ctx, { question, draft }) {
    const w = await ctx.world();
    const d = draft ?? draftDecision(w, question);
    const [row] = await ctx.db.insert(s.decisions).values({ userId: ctx.userId, title: d.title, question: d.question, domain: d.domain, stakes: d.stakes, reversibility: d.reversibility, model: d.model }).returning();
    const opts = await ctx.db.insert(s.decisionOptions).values(d.options.map((o: { label: string }, i: number) => ({ ...o, decisionId: row.id, position: i }))).returning();
    const crits = await ctx.db.insert(s.decisionCriteria).values(d.criteria.map((c: { name: string; weight: number; goalId?: string; rationale?: string }) => ({ decisionId: row.id, name: c.name, weight: c.weight, linkedGoalId: c.goalId ?? null, rationale: c.rationale }))).returning();
    if (d.scores.length)
      await ctx.db.insert(s.decisionScores).values(
        d.scores.map((sc: { option: number; criterion: number; score: number; low: number; high: number; rationale: string }) => ({ optionId: opts[sc.option].id, criterionId: crits[sc.criterion].id, score: sc.score, low: sc.low, high: sc.high, rationale: sc.rationale, provenance: "estimate" })),
      );
    await ctx.db.insert(s.activities).values({ userId: ctx.userId, entityType: "decision", entityId: row.id, action: "created", summary: `Decision workspace created: ${row.title}` });
    await indexEntities(ctx.db, ctx.userId, "decision", [row.id]);
    return { id: row.id, title: row.title };
  },
});

defineTool({
  name: "create_memory",
  description: "Store a long-term memory with provenance. Always requires the user's approval — no hidden profiling.",
  permission: "write",
  input: z.object({ content: z.string().min(3).max(500), category: z.enum(["preference", "fact", "lesson", "constraint", "pattern", "person", "goal"]), source: z.enum(["user_input", "document", "decision", "integration", "ai_inference"]), confidence: z.number().min(0).max(1).default(0.8), importance: z.number().int().min(1).max(5).default(3) }),
  output: z.object({ id: z.string() }),
  propose: (i) => ({ title: `Remember: “${i.content}”`, explanation: `Category ${i.category}, source ${i.source.replace("_", " ")}, confidence ${Math.round(i.confidence * 100)}%. You can edit or delete it later in Knowledge → Memory.` }),
  async handler(ctx, input) {
    const [m] = await ctx.db.insert(s.memories).values({ ...input, userId: ctx.userId, lastVerifiedAt: input.source === "user_input" ? new Date() : null }).returning();
    await indexEntities(ctx.db, ctx.userId, "memory", [m.id]);
    return { id: m.id };
  },
});

defineTool({
  name: "link_entities",
  description: "Create a typed relationship in the knowledge graph (e.g. project evidences opportunity).",
  permission: "write",
  input: z.object({ fromType: z.string(), fromId: uuid, toType: z.string(), toId: uuid, relation: z.string().max(40), rationale: z.string().max(300).optional() }),
  output: z.object({ ok: z.boolean() }),
  async propose(i, ctx) {
    const w = await ctx.world();
    return { title: `Link ${refOf(w, i.fromType as EntityType, i.fromId).label} → ${refOf(w, i.toType as EntityType, i.toId).label}`, explanation: `Relation “${i.relation}”. ${i.rationale ?? ""}` };
  },
  async handler(ctx, i) {
    await ctx.db.insert(s.links).values({ ...i, userId: ctx.userId, provenance: "ai_inference", strength: 0.7 }).onConflictDoNothing();
    return { ok: true };
  },
});

defineTool({
  name: "create_project_from_document",
  description: "Create a project (and tasks for extracted deadlines/requirements) from a processed document.",
  permission: "write",
  input: z.object({ documentId: uuid, goalId: uuid.optional() }),
  output: z.object({ projectId: z.string(), tasks: z.number() }),
  async propose({ documentId }, ctx) {
    const w = await ctx.world();
    const d = w.idx.document.get(documentId);
    return { title: `Create project from “${d?.title}”`, explanation: `Uses the extracted ${d?.kind.replace("_", " ")} fields to create a project with dated tasks.` };
  },
  async handler(ctx, { documentId, goalId }) {
    const w = await ctx.world();
    const d = w.idx.document.get(documentId);
    if (!d) throw new Error("Document not found");
    const fields = w.documentFields.filter((f) => f.documentId === documentId);
    const get = (k: string) => fields.find((f) => f.key === k)?.value;
    const careerGoal = goalId ?? w.goals.filter((g) => g.category === "career" && g.status === "active").sort((a, b) => b.priority - a.priority)[0]?.id;
    const title = d.kind === "job_description" ? `Apply: ${get("role") ?? d.title}${get("company") ? ` at ${get("company")}` : ""}` : `Handle: ${d.title}`;
    const deadline = get("deadline") ?? get("due_date") ?? get("notice_deadline") ?? null;
    const [p] = await ctx.db.insert(s.projects).values({ userId: ctx.userId, goalId: d.kind === "job_description" ? careerGoal : null, title, description: d.summary, status: "active", priority: 4, dueDate: deadline, currentState: "Created from document" }).returning();
    const tasks: (typeof s.tasks.$inferInsert)[] = [];
    if (d.kind === "job_description") {
      tasks.push({ userId: ctx.userId, projectId: p.id, title: `Tailor CV to ${get("role") ?? "the role"}`, estimateMinutes: 50, dueDate: deadline, source: "document" });
      tasks.push({ userId: ctx.userId, projectId: p.id, title: "Write cover letter addressing requirements", estimateMinutes: 60, dueDate: deadline, source: "document" });
      for (const req of (get("requirements") ?? "").split("\n").slice(0, 3)) if (req) tasks.push({ userId: ctx.userId, projectId: p.id, title: `Evidence for: ${req.slice(0, 90)}`, estimateMinutes: 15, source: "document" });
      tasks.push({ userId: ctx.userId, projectId: p.id, title: "Submit application", estimateMinutes: 20, dueDate: deadline, source: "document" });
    } else {
      for (const f of fields.filter((f) => f.valueType === "date")) tasks.push({ userId: ctx.userId, projectId: p.id, title: `${f.label}: act before ${f.value}`, dueDate: f.value, estimateMinutes: 20, source: "document" });
    }
    const ins = tasks.length ? await ctx.db.insert(s.tasks).values(tasks).returning({ id: s.tasks.id }) : [];
    await ctx.db.insert(s.links).values({ userId: ctx.userId, fromType: "document", fromId: d.id, toType: "project", toId: p.id, relation: "source_of", provenance: "document" }).onConflictDoNothing();
    await ctx.db.insert(s.activities).values({ userId: ctx.userId, entityType: "project", entityId: p.id, action: "created", summary: `Project created from document: ${title}` });
    await indexEntities(ctx.db, ctx.userId, "project", [p.id]);
    await indexEntities(ctx.db, ctx.userId, "task", ins.map((t) => t.id));
    return { projectId: p.id, tasks: ins.length };
  },
});

defineTool({
  name: "generate_report",
  description: "Generate and store the weekly intelligence report (a derived artefact — no records are modified).",
  permission: "write",
  autoApprove: true,
  input: z.object({}),
  output: z.object({ id: z.string(), weekStart: z.string() }),
  async handler(ctx) {
    const report = weeklyReport(await ctx.world());
    const [row] = await ctx.db
      .insert(s.weeklyReports)
      .values({ userId: ctx.userId, weekStart: report.weekStart, content: report as unknown as Record<string, unknown> })
      .onConflictDoUpdate({ target: [s.weeklyReports.userId, s.weeklyReports.weekStart], set: { content: report as unknown as Record<string, unknown>, createdAt: new Date() } })
      .returning();
    return { id: row.id, weekStart: row.weekStart };
  },
});

/* ═════════════════════════════ EXTERNAL / DESTRUCTIVE ═════════════════════════════ */

defineTool({
  name: "send_message",
  description: "Send a message to a contact through a connected provider. External action — always requires approval.",
  permission: "external",
  risk: "medium",
  input: z.object({ personId: uuid, channel: z.enum(["email", "linkedin", "whatsapp"]), subject: z.string().max(200).default(""), body: z.string().min(1).max(5000) }),
  output: z.object({ messageId: z.string(), externalId: z.string() }),
  async propose(i, ctx) {
    const p = (await ctx.world()).idx.person.get(i.personId);
    return { title: `Send ${i.channel} to ${p?.name}`, explanation: `“${i.body.slice(0, 220)}${i.body.length > 220 ? "…" : ""}” — this leaves LIFEOS and cannot be unsent.` };
  },
  async handler(ctx, i) {
    const w = await ctx.world();
    const p = w.idx.person.get(i.personId);
    if (!p) throw new Error("Person not found");
    const res = await messagingFor(i.channel).send(p.email ?? p.name, i.subject, i.body);
    const [m] = await ctx.db.insert(s.messages).values({ userId: ctx.userId, personId: p.id, channel: i.channel, direction: "out", subject: i.subject || null, body: i.body, occurredAt: res.deliveredAt, provider: "mock", externalId: res.externalId }).returning();
    await ctx.db.update(s.messages).set({ needsReply: false }).where(and(eq(s.messages.userId, ctx.userId), eq(s.messages.personId, p.id), eq(s.messages.direction, "in")));
    await ctx.db.update(s.people).set({ lastContactAt: new Date() }).where(eq(s.people.id, p.id));
    await ctx.db.insert(s.activities).values({ userId: ctx.userId, entityType: "person", entityId: p.id, action: "contacted", summary: `Sent ${i.channel} to ${p.name}` });
    await indexEntities(ctx.db, ctx.userId, "message", [m.id]);
    return { messageId: m.id, externalId: res.externalId };
  },
});

const DELETABLE: Record<string, typeof s.tasks | typeof s.notes | typeof s.ideas | typeof s.memories | typeof s.opportunities | typeof s.commitments> = {
  task: s.tasks,
  note: s.notes,
  idea: s.ideas,
  memory: s.memories,
  opportunity: s.opportunities,
  commitment: s.commitments,
};

defineTool({
  name: "delete_entity",
  description: "Permanently delete a record. Destructive — always requires explicit approval.",
  permission: "destructive",
  risk: "high",
  input: z.object({ type: z.enum(["task", "note", "idea", "memory", "opportunity", "commitment"]), id: uuid }),
  output: z.object({ deleted: z.boolean() }),
  async propose(i, ctx) {
    return { title: `Delete ${i.type}: ${refOf(await ctx.world(), i.type, i.id).label}`, explanation: "Permanent deletion. This cannot be undone." };
  },
  async handler(ctx, { type, id }) {
    const table = DELETABLE[type];
    const res = await ctx.db.delete(table).where(and(eq(table.id, id), eq(table.userId, ctx.userId))).returning({ id: table.id });
    await removeFromIndex(ctx.db, ctx.userId, type, id);
    return { deleted: res.length > 0 };
  },
});

export const TOOLS_LOADED = true;
