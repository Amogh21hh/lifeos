import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getRawDb, type DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { seedDemo } from "@/server/db/seed";
import { loadWorld, type World } from "@/server/engine/world";
import { buildBriefing } from "@/server/engine/briefing";
import { rankActions, urgency, effortFactor } from "@/server/engine/actions";
import { whatAmIMissing } from "@/server/engine/missing";
import { analyzeDecision, draftDecision } from "@/server/engine/decision";
import { classifyScenario, simulate } from "@/server/engine/simulate";
import { buildRadarMap, opportunityRadar } from "@/server/engine/radar";
import { moveProjectForward } from "@/server/engine/autopilot";
import { weeklyReport } from "@/server/engine/weekly";
import { opportunityFit, projectProgress } from "@/server/engine/signals";
import { hybridSearch, parseQuery } from "@/server/search/search";
import { executeTool, makeToolContext, resolveApproval } from "@/server/tools/registry";
import "@/server/tools/definitions";
import { routeByRules, runCommand } from "@/server/agents/orchestrator";

let db: DB;
let userId: string;
let w: World;
const NOW = new Date("2026-10-03T12:00:00Z");

beforeAll(async () => {
  db = await getRawDb();
  userId = await seedDemo(db, NOW);
  w = await loadWorld(db, userId, NOW);
});
afterAll(async () => {
  await closeDb();
});

describe("demo world", () => {
  it("meets the minimum demo volumes", () => {
    expect(w.goals.length).toBeGreaterThanOrEqual(10);
    expect(w.projects.length).toBeGreaterThanOrEqual(10);
    expect(w.tasks.length).toBeGreaterThanOrEqual(20);
    expect(w.opportunities.length).toBeGreaterThanOrEqual(15);
    expect(w.people.length).toBeGreaterThanOrEqual(10);
    expect(w.documents.length).toBeGreaterThanOrEqual(10);
    expect(w.memories.length).toBeGreaterThanOrEqual(20);
    expect(w.decisions.length).toBeGreaterThanOrEqual(10);
    expect(w.documents.every((d) => d.status === "processed")).toBe(true);
  });
});

describe("explainability contract", () => {
  it("every action and blind spot carries evidence, a confidence and a stable key", () => {
    const all = [...rankActions(w), ...whatAmIMissing(w)];
    expect(all.length).toBeGreaterThan(10);
    for (const i of all) {
      expect(i.key).toBeTruthy();
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(["low", "medium", "high"]).toContain(i.confidence);
      expect(i.confidenceScore).toBeGreaterThanOrEqual(0);
      expect(i.confidenceScore).toBeLessThanOrEqual(1);
      for (const e of i.evidence) expect(["fact", "estimate", "assumption", "user_input", "ai_inference"]).toContain(e.provenance);
    }
    expect(new Set(all.map((i) => i.key)).size).toBe(all.length);
  });
  it("actions expose their full score breakdown", () => {
    for (const a of rankActions(w)) expect(a.scoreBreakdown?.map((b) => b.factor)).toEqual(["Impact", "Urgency", "Confidence", "Effort"]);
  });
});

describe("leverage scoring", () => {
  it("urgency rises as deadlines approach and effort dampens long tasks", () => {
    expect(urgency(0)).toBeGreaterThan(urgency(3));
    expect(urgency(3)).toBeGreaterThan(urgency(14));
    expect(urgency(-1)).toBeGreaterThan(urgency(0));
    expect(effortFactor(240)).toBeGreaterThan(effortFactor(10));
  });
  it("ranks the time-critical recruiter reply and interview prep above routine follow-ups", () => {
    const titles = rankActions(w).slice(0, 5).map((a) => a.title);
    expect(titles.some((t) => /Sophie|Priya/.test(t))).toBe(true);
    expect(titles.some((t) => /Meridian case study/.test(t))).toBe(true);
  });
});

describe("briefing", () => {
  const b = () => buildBriefing(w);
  it("greets, counts and surfaces the allocation insight", () => {
    expect(b().greeting).toMatch(/Amogh/);
    expect(b().meaningfulCount).toBeGreaterThan(0);
    expect(b().systemInsight?.conclusion).toMatch(/highest-priority objective/);
  });
  it("lists document-derived deadlines", () => {
    expect(b().deadlines.some((d) => d.source === "document")).toBe(true);
  });
});

describe("what am I missing", () => {
  const detectors = () => new Set(whatAmIMissing(w).map((i) => i.detector));
  it.each(["applicationFollowUps", "unlinkedEvidence", "repeatedPostponement", "cheapUnblocks", "untrackedDocumentDeadlines", "coolingRelationships", "skillGapClusters", "timeMisallocation", "visaRunway", "quickWins"])("detects %s in the demo world", (d) => {
    expect(detectors().has(d)).toBe(true);
  });
  it("finds the tenancy notice deadline hidden in a contract", () => {
    const hit = whatAmIMissing(w).find((i) => i.detector === "untrackedDocumentDeadlines" && /Tenancy/.test(i.title));
    expect(hit).toBeDefined();
    expect(hit!.conclusion).toMatch(/notice/i);
  });
  it("does not invent problems in an empty world", async () => {
    const [empty] = await db.insert(s.users).values({ email: "empty@test.local", name: "Empty", passwordHash: "x" }).returning();
    const ew = await loadWorld(db, empty.id, NOW);
    expect(whatAmIMissing(ew)).toEqual([]);
    expect(rankActions(ew)).toEqual([]);
  });
});

describe("signals", () => {
  it("measures project progress by estimated effort", () => {
    const dcf = w.projects.find((p) => p.title.startsWith("Rolls-Royce"))!;
    expect(projectProgress(w, dcf.id).pct).toBeGreaterThan(0.8);
  });
  it("penalises fit when an employer won't sponsor a needed visa", () => {
    const nb = w.opportunities.find((o) => o.title.includes("Northbridge"))!;
    const fit = opportunityFit(w, nb.id);
    expect(fit.visaRisk.blocked).toBe(true);
    expect(fit.components.some((c) => c.factor === "Visa" && c.value < 0)).toBe(true);
  });
});

describe("decision engine", () => {
  it("computes scenarios, sensitivity and questions without choosing for the user", () => {
    const d = w.decisions.find((x) => x.title.includes("bootcamp"))!;
    const options = w.decisionOptions.filter((o) => o.decisionId === d.id);
    const criteria = w.decisionCriteria.filter((c) => c.decisionId === d.id);
    const scores = w.decisionScores.filter((sc) => options.some((o) => o.id === sc.optionId));
    const a = analyzeDecision(w, { decision: d, options, criteria, scores });
    expect(a.scenarios.map((x) => x.name)).toEqual(["Pessimistic", "Base", "Optimistic"]);
    expect(a.sensitivity).toHaveLength(criteria.length);
    expect(a.questions.length).toBeGreaterThan(0);
    expect(a.summary).not.toMatch(/you should/i);
    for (const o of a.options) expect(o.worst).toBeLessThanOrEqual(o.best);
  });
  it("drafts a purchase decision with cost-aware criteria and three options", () => {
    const d = draftDecision(w, "Should I buy a new laptop for £1,100?");
    expect(d.domain).toBe("purchase");
    expect(d.options).toHaveLength(3);
    expect(d.criteria.some((c) => c.name === "Cost & runway")).toBe(true);
    expect(d.scores).toHaveLength(d.options.length * d.criteria.length);
    expect(Math.abs(d.criteria.reduce((a, c) => a + c.weight, 0) - 1)).toBeLessThan(0.01);
  });
});

describe("simulator", () => {
  it.each([
    ["What happens if I work 10 extra hours this month?", "extra_hours"],
    ["What happens if I stop the half-marathon training?", "stop_project"],
    ["What happens if I spend £300 on this?", "spend"],
    ["What happens if I delay the WACC table by 5 days?", "delay_deadline"],
    ["What happens if I learn SQL?", "learn_skill"],
  ])("%s → %s", (q, type) => {
    expect(classifyScenario(q)).toBe(type);
    const r = simulate(w, q);
    expect(r.scenarioType).toBe(type);
    expect(r.effects.length).toBeGreaterThan(0);
    expect(r.caveats.length).toBeGreaterThan(0);
  });
  it("assumption overrides change the outcome", () => {
    const base = simulate(w, "What happens if I spend £300 on this?");
    const more = simulate(w, "What happens if I spend £300 on this?", { amount: 3000 });
    expect(more.effects[0].after).not.toBe(base.effects[0].after);
  });
});

describe("radar, autopilot and weekly report", () => {
  it("opportunity radar labels upside provenance and keeps success rates as assumptions", () => {
    const r = opportunityRadar(w, "I want to increase my income");
    expect(r.theme).toBe("income");
    expect(r.routes.length).toBeGreaterThan(3);
    for (const route of r.routes) expect(route.assumptions.length + (route.kind === "inferred" ? 1 : 0)).toBeGreaterThan(0);
    expect(r.routes.some((x) => x.kind === "inferred")).toBe(true);
  });
  it("radar map infers potential opportunities with full reasoning", () => {
    const m = buildRadarMap(w);
    expect(m.potentials.length).toBeGreaterThan(2);
    for (const p of m.potentials) {
      expect(p.why).toBeTruthy();
      expect(p.supports.length).toBeGreaterThan(0);
      expect(p.nextAction).toBeTruthy();
    }
  });
  it("autopilot leads with the cheap unblocking step for a blocked project", () => {
    const credit = w.projects.find((p) => p.title.startsWith("Credit risk"))!;
    const plan = moveProjectForward(w, credit.id);
    expect(plan.smallestNextAction?.title).toMatch(/Re-download Lending Club/);
    expect(plan.blockers.length).toBeGreaterThan(0);
  });
  it("weekly report includes wins, focus and patterns", () => {
    const r = weeklyReport(w);
    expect(r.wins.length).toBeGreaterThan(0);
    expect(r.focus.length).toBeGreaterThan(0);
    expect(r.patterns.length).toBeGreaterThan(0);
  });
});

describe("hybrid search", () => {
  it("parses metadata filters and graph anchors", () => {
    expect(parseQuery("Which commitments are currently overdue?")).toMatchObject({ types: ["commitment"], status: "overdue" });
    expect(parseQuery("What projects demonstrate my Python skills?")).toMatchObject({ anchor: "Python", relation: "evidences" });
  });
  it("answers relational questions with explained matches", async () => {
    const live = await loadWorld(db, userId, NOW);
    const r = await hybridSearch(db, live, "What projects demonstrate my Python skills?");
    expect(r.results[0].ref.label).toMatch(/Credit risk PD model/);
    expect(r.results[0].reasons.join(" ")).toMatch(/Evidences Python/);
    const overdue = await hybridSearch(db, live, "Which commitments are currently overdue?");
    expect(overdue.results.slice(0, 2).every((x) => x.ref.type === "commitment")).toBe(true);
  });
});

describe("tool permissions & approvals", () => {
  it("read tools execute immediately and are audited", async () => {
    const ctx = makeToolContext(db, userId, "TestAgent", null);
    const r = await executeTool(ctx, "find_deadlines", { days: 14 }, ["find_deadlines"]);
    expect(r.status).toBe("ok");
    const calls = await db.select().from(s.toolCalls).where(eq(s.toolCalls.tool, "find_deadlines"));
    expect(calls.length).toBeGreaterThan(0);
  });
  it("tools outside an agent's allowlist are denied", async () => {
    const ctx = makeToolContext(db, userId, "TestAgent", null);
    const r = await executeTool(ctx, "delete_entity", { type: "note", id: "00000000-0000-4000-8000-000000000000" }, ["search_memory"]);
    expect(r.status).toBe("denied");
  });
  it("write tools are queued, never executed silently, and run exactly once on approval", async () => {
    const ctx = makeToolContext(db, userId, "TestAgent", null);
    const before = (await db.select().from(s.tasks).where(eq(s.tasks.userId, userId))).length;
    const r = await executeTool(ctx, "create_task", { title: "Approval test task" }, ["create_task"]);
    expect(r.status).toBe("pending_approval");
    expect((await db.select().from(s.tasks).where(eq(s.tasks.userId, userId))).length).toBe(before);
    if (r.status !== "pending_approval") throw new Error("expected approval");
    const res = await resolveApproval(db, userId, r.approvalId, "approve");
    expect(res.status).toBe("executed");
    expect((await db.select().from(s.tasks).where(eq(s.tasks.userId, userId))).length).toBe(before + 1);
    await expect(resolveApproval(db, userId, r.approvalId, "approve")).rejects.toThrow(/already/);
  });
  it("rejected approvals change nothing", async () => {
    const ctx = makeToolContext(db, userId, "TestAgent", null);
    const r = await executeTool(ctx, "create_memory", { content: "Rejected memory", category: "fact", source: "ai_inference" }, ["create_memory"]);
    if (r.status !== "pending_approval") throw new Error("expected approval");
    await resolveApproval(db, userId, r.approvalId, "reject");
    const mem = await db.select().from(s.memories).where(eq(s.memories.content, "Rejected memory"));
    expect(mem).toHaveLength(0);
  });
  it("invalid tool input is rejected by the schema", async () => {
    const ctx = makeToolContext(db, userId, "TestAgent", null);
    const r = await executeTool(ctx, "calculate_scenario", { question: "" }, ["calculate_scenario"]);
    expect(r.status).toBe("error");
  });
});

describe("orchestrator", () => {
  it.each([
    ["What am I missing?", "ReflectionAgent"],
    ["Should I buy a car?", "DecisionAgent"],
    ["I want to increase my income", "OpportunityAgent"],
    ["Find unfinished projects.", "ProjectAgent"],
    ["What happens if I spend £300?", "FinanceAgent"],
    ["Prepare my weekly review.", "PlannerAgent"],
    ["Draft a reply to Priya", "OutreachAgent"],
    ["Remember that I prefer hybrid roles", "MemoryAgent"],
    ["Show me everything related to my finance career.", "ResearchAgent"],
  ])("routes “%s” to %s", (q, agent) => {
    expect(routeByRules(q).agent).toBe(agent);
  });
  it("runs a command end to end and logs the run", async () => {
    const r = await runCommand(db, userId, "What should I focus on this week?", { aiMode: "local" });
    expect(r.status).toBe("ok");
    expect(r.blocks.some((b) => b.type === "plan")).toBe(true);
    const [run] = await db.select().from(s.aiRuns).where(eq(s.aiRuns.id, r.runId));
    expect(run.status).toBe("ok");
    expect(run.engine).toBe("local");
  });
});
