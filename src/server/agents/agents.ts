/**
 * Specialised agents. Each one owns a responsibility and a minimal tool allowlist.
 */
import { z } from "zod";
import { daysUntil, hours, money, relativeDay } from "@/lib/format";
import type { EntityRef, Insight, OpportunityRoute, PlanStep, ResultBlock, SearchResult, SimulationResult } from "@/lib/types";
import { cosine, localEmbed } from "@/server/ai/embeddings";
import type { AutopilotPlan } from "@/server/engine/autopilot";
import type { DecisionAnalysis, DecisionDraft } from "@/server/engine/decision";
import { draftDecision } from "@/server/engine/decision";
import { insight } from "@/server/engine/insight";
import { DETECTORS } from "@/server/engine/missing";
import type { FinanceSummary } from "@/server/engine/signals";
import type { ChangeItem, WeeklyReport } from "@/server/engine/weekly";
import { refOf, type World } from "@/server/engine/world";
import type { ExtractionResult } from "@/server/documents/extract";
import { defineAgent, narrate, type AgentContext, type AgentOutput } from "./base";

function approvalBlock(res: { status: string; approvalId?: string; title?: string; explanation?: string; risk?: string }, tool: string, payload: Record<string, unknown>): ResultBlock | null {
  if (res.status !== "pending_approval" || !res.approvalId) return null;
  return { type: "approval", approvalId: res.approvalId, title: res.title ?? tool, explanation: res.explanation ?? "", risk: res.risk ?? "low", tool, payload };
}

function findByText<T>(items: T[], label: (t: T) => string, text: string): T | undefined {
  const q = text.toLowerCase();
  const direct = items.find((i) => q.includes(label(i).toLowerCase()));
  if (direct) return direct;
  const words = q.split(/[^a-z0-9]+/).filter((w) => w.length > 3);
  const scored = items.map((i) => ({ i, hits: label(i).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length > 3 && words.includes(x)).length })).filter((x) => x.hits > 0);
  if (scored.length) return scored.sort((a, b) => b.hits - a.hits)[0].i;
  return undefined;
}

/* ═══════════════════ ResearchAgent ═══════════════════ */
export const ResearchAgent = defineAgent({
  name: "ResearchAgent",
  description: "Finds and connects information across everything LIFEOS knows.",
  responsibilities: ["Hybrid search across records", "Graph exploration around people/companies/skills", "Memory recall for questions about the past", "Web search (with approval)"],
  input: z.object({ query: z.string().min(1).max(500), web: z.boolean().default(false) }),
  tools: ["search_everything", "search_memory", "find_relationships", "search_web"],
  async run(ctx, { query, web }): Promise<AgentOutput> {
    const res = await ctx.need<{ results: SearchResult[]; anchor: { type: string; id: string; label: string } | null; parsed: { types: string[]; status: string | null } }>("search_everything", { query, limit: 20 });
    const blocks: ResultBlock[] = [{ type: "search", title: `Results for “${query}”`, results: res.results }];
    if (/\b(decid|lesson|prefer|remember|learn)/i.test(query)) {
      const mem = await ctx.need<{ id: string; content: string; source: string; confidence: number }[]>("search_memory", { query });
      if (mem.length) blocks.push({ type: "memories", title: "Related memories", items: mem.slice(0, 5) });
    }
    if (web) {
      const r = await ctx.tool("search_web", { query });
      const b = approvalBlock(r as never, "search_web", { query });
      if (b) blocks.push(b);
    }
    const types = [...new Set(res.results.map((r) => r.ref.type))];
    const fallback = res.results.length
      ? `Found ${res.results.length} result${res.results.length === 1 ? "" : "s"} across ${types.join(", ")}${res.anchor ? `, including everything connected to ${res.anchor.label} in your knowledge graph` : ""}. Each result shows why it matched.`
      : `Nothing matched “${query}”. Try different words, or check the spelling of names.`;
    return { summary: await narrate(ctx, `Summarise search results for “${query}”`, res.results.slice(0, 8).map((r) => ({ title: r.ref.label, type: r.ref.type, why: r.reasons })), fallback), blocks };
  },
});

/* ═══════════════════ PlannerAgent ═══════════════════ */
export const PlannerAgent = defineAgent({
  name: "PlannerAgent",
  description: "Turns priorities, deadlines and capacity into focus plans, reviews and scenarios.",
  responsibilities: ["Weekly focus plans", "Weekly intelligence report", "What-if simulations (time & projects)", "Deadline overviews"],
  input: z.object({ op: z.enum(["focus", "weekly", "simulate", "deadlines"]), question: z.string().max(500).optional(), overrides: z.record(z.string(), z.number()).optional() }),
  tools: ["rank_actions", "what_am_i_missing", "find_deadlines", "weekly_review", "generate_report", "calculate_scenario"],
  async run(ctx, input): Promise<AgentOutput> {
    const w = await ctx.world();
    if (input.op === "simulate") {
      const sim = await ctx.need<SimulationResult>("calculate_scenario", { question: input.question ?? "", overrides: input.overrides ?? {} });
      return { summary: sim.headline, blocks: [{ type: "simulation", result: sim }] };
    }
    if (input.op === "deadlines") {
      const d = await ctx.need<{ label: string; date: string; days: number; type: string; id: string; source: string }[]>("find_deadlines", { days: 21 });
      return {
        summary: `${d.filter((x) => x.days < 0).length} overdue and ${d.filter((x) => x.days >= 0).length} upcoming in the next 3 weeks.`,
        blocks: [{ type: "entities", title: "Deadlines", items: d.map((x) => ({ ...refOf(w, x.type as never, x.id), label: x.label, subtitle: `${x.source} · ${x.date}`, meta: x.days < 0 ? `${-x.days}d overdue` : relativeDay(x.date, w.now) })) }],
      };
    }
    if (input.op === "weekly") {
      const stored = await ctx.need<{ id: string; weekStart: string }>("generate_report", {});
      const r = await ctx.need<WeeklyReport>("weekly_review", {});
      return {
        summary: await narrate(ctx, "Summarise the weekly report in 2 sentences", { headline: r.headline, wins: r.wins.slice(0, 5), stalled: r.stalledProjects, focus: r.focus }, r.headline),
        blocks: [
          { type: "report", reportId: stored.id, title: `Weekly intelligence report · week of ${stored.weekStart}`, href: "/weekly" },
          { type: "text", title: "Wins", body: r.wins.length ? r.wins.map((x) => `• ${x}`).join("\n") : "No completions logged this week." },
          { type: "plan", title: "Recommended focus", steps: r.focus.map((f) => ({ title: f.title, detail: f.why, why: f.goal ? `Serves “${f.goal}”` : "High leverage", kind: "do" as const })), rationale: "Top-ranked actions, at most one per goal." },
        ],
      };
    }
    // focus
    const actions = await ctx.need<Insight[]>("rank_actions", { limit: 10 });
    const missing = await ctx.need<Insight[]>("what_am_i_missing", {});
    const capacity = w.settings.focusHoursPerWeek * 60;
    let used = 0;
    const steps: PlanStep[] = [];
    const goalsSeen = new Map<string, number>();
    for (const a of actions) {
      const minutes = a.actions?.[0]?.minutes ?? 30;
      const goal = a.scoreBreakdown?.[0]?.note.match(/Goal “(.+?)”/)?.[1] ?? "General";
      if ((goalsSeen.get(goal) ?? 0) >= 2) continue;
      if (used + minutes > capacity * 0.6) break;
      goalsSeen.set(goal, (goalsSeen.get(goal) ?? 0) + 1);
      used += minutes;
      steps.push({ title: a.title, detail: a.conclusion, minutes, why: `Leverage ${a.score} · ${a.scoreBreakdown?.map((b) => `${b.factor} ${b.value}`).join(", ")}`, refs: a.refs, kind: "do" });
      if (steps.length >= 7) break;
    }
    const allocation = missing.find((m) => m.detector === "timeMisallocation");
    return {
      summary: await narrate(
        ctx,
        "Explain this week's focus plan",
        { steps: steps.map((s) => s.title), allocation: allocation?.conclusion, capacityHours: w.settings.focusHoursPerWeek },
        `${steps.length} high-leverage actions fill ${hours(used)} of your ${w.settings.focusHoursPerWeek}h focus capacity, leaving ~40% for deep work.${allocation ? ` ${allocation.conclusion}` : ""}`,
      ),
      blocks: [
        { type: "plan", title: "This week's focus", steps, rationale: "Ranked by leverage = impact × urgency × confidence ÷ effort; at most two items per goal; 60% capacity cap so deep work survives." },
        { type: "insights", title: "Why these, and what to watch", items: [...(allocation ? [allocation] : []), ...actions.slice(0, 3)] },
      ],
    };
  },
});

/* ═══════════════════ DocumentAgent ═══════════════════ */
const LlmExtraction = z.object({
  kind: z.enum(["job_description", "invoice", "contract", "cv", "bank_statement", "offer_letter", "correspondence", "course", "immigration", "spreadsheet", "note", "image", "other"]),
  summary: z.string(),
  fields: z.array(z.object({ key: z.string(), label: z.string(), value: z.string(), valueType: z.enum(["text", "money", "date", "list", "number", "percent"]), confidence: z.number(), quote: z.string() })),
});

/** LLM enhancement of rule-based extraction. Each LLM field must quote the text; quotes are located to produce source spans. */
export function llmDocumentEnhancer(ctx: AgentContext) {
  return async ({ text, filename, rules, imageBase64 }: { text: string; filename: string; rules: ExtractionResult; imageBase64?: { mediaType: string; data: string } }): Promise<ExtractionResult | null> => {
    const limit = 60_000;
    const out = await ctx.llmStructured({
      system:
        "You extract structured data from personal documents for LIFEOS. Return fields relevant to the document type (job description: company, role, salary, location, requirements, skills, deadline, experience, visa, responsibilities; invoice: vendor, invoice_number, invoice_date, amount, vat, due_date, category; contract: parties, start_date, end_date, obligations, renewal terms, clauses, risks). Dates as YYYY-MM-DD. Every field MUST include `quote`: an exact, verbatim substring of the document that supports it. Never infer values that are not in the text; omit them instead.",
      prompt: `Filename: ${filename}\nRule-based extraction (may be incomplete): ${JSON.stringify({ kind: rules.kind, fields: rules.fields.map((f) => ({ key: f.key, value: f.value })) })}\n\nDOCUMENT${text.length > limit ? ` (first ${limit} of ${text.length} characters)` : ""}:\n${text.slice(0, limit) || "(image — transcribe and extract)"}`,
      schema: LlmExtraction,
      maxTokens: 6000,
      images: imageBase64 ? [{ mediaType: imageBase64.mediaType as "image/png", data: imageBase64.data }] : undefined,
    });
    if (!out) return null;
    const merged = new Map(rules.fields.map((f) => [f.key, f]));
    for (const f of out.fields) {
      const idx = f.quote ? text.indexOf(f.quote) : -1;
      const located = idx >= 0;
      const existing = merged.get(f.key);
      if (existing && existing.confidence >= 0.85 && !located) continue; // keep high-confidence, span-backed rule field
      merged.set(f.key, {
        key: f.key,
        label: f.label,
        value: f.value,
        valueType: f.valueType,
        confidence: Number(Math.min(0.95, Math.max(0.1, f.confidence) * (located ? 1 : 0.6)).toFixed(2)),
        sourceText: located ? f.quote : null,
        sourceStart: located ? idx : null,
        sourceEnd: located ? idx + f.quote.length : null,
        method: "llm",
      });
    }
    return { kind: out.kind, kindConfidence: 0.9, kindSignals: [...rules.kindSignals, "llm"], fields: [...merged.values()], summary: out.summary };
  };
}

export const DocumentAgent = defineAgent({
  name: "DocumentAgent",
  description: "Understands uploaded documents and turns them into structured, actionable records.",
  responsibilities: ["Explain extracted fields with sources", "Create projects/tasks from documents (with approval)", "Find documents"],
  input: z.object({ op: z.enum(["analyze", "project_from_document", "task_for_deadline"]), documentId: z.string().uuid().optional(), text: z.string().max(500).optional() }),
  tools: ["analyze_document", "create_project_from_document", "create_task", "search_documents"],
  async run(ctx, input): Promise<AgentOutput> {
    const w = await ctx.world();
    const doc = input.documentId ? w.idx.document.get(input.documentId) : (input.text && findByText(w.documents, (d) => d.title, input.text)) || [...w.documents].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime())[0];
    if (!doc) return { summary: "No document found. Upload one in Documents first.", blocks: [] };
    const ref: EntityRef = { type: "document", id: doc.id, label: doc.title };
    if (input.op === "project_from_document") {
      const r = await ctx.tool("create_project_from_document", { documentId: doc.id });
      const b = approvalBlock(r as never, "create_project_from_document", { documentId: doc.id });
      return { summary: `I've prepared a project from “${doc.title}”. Review and approve to create it.`, blocks: [...(b ? [b] : []), { type: "entities", title: "Source document", items: [ref] }] };
    }
    if (input.op === "task_for_deadline") {
      const fields = w.documentFields.filter((f) => f.documentId === doc.id && f.valueType === "date" && (daysUntil(f.value, w.now) ?? -1) >= 0).sort((a, b) => a.value.localeCompare(b.value));
      const f = fields.find((x) => input.text && x.label.toLowerCase().split(/\W+/).some((t) => t.length > 3 && input.text!.toLowerCase().includes(t))) ?? fields[0];
      if (!f) return { summary: `“${doc.title}” has no upcoming dates.`, blocks: [] };
      const payload = { title: `${f.label}: ${doc.title.split("—")[0].trim()}`, dueDate: f.value, estimateMinutes: 15, description: `From document “${doc.title}”: ${f.sourceText ?? f.value}` };
      const r = await ctx.tool("create_task", payload);
      const b = approvalBlock(r as never, "create_task", payload);
      return { summary: `Proposed a task for ${f.label.toLowerCase()} (${f.value}). Approve to add it.`, blocks: b ? [b] : [] };
    }
    const a = await ctx.need<{ document: World["documents"][number]; fields: World["documentFields"] }>("analyze_document", { documentId: doc.id });
    return {
      summary: a.document.summary ?? `${a.fields.length} fields extracted.`,
      blocks: [
        { type: "metrics", title: `${a.document.title} · ${a.document.kind.replace("_", " ")}`, items: a.fields.slice(0, 12).map((f) => ({ label: f.label, value: f.value.split("\n")[0].slice(0, 80), provenance: f.method === "user" ? ("user_input" as const) : f.key.endsWith("(derived)") || f.key === "notice_deadline" ? ("ai_inference" as const) : ("fact" as const), hint: `${Math.round(f.confidence * 100)}% · ${f.method}` })) },
        { type: "entities", title: "Open document", items: [ref] },
      ],
    };
  },
});

/* ═══════════════════ DecisionAgent ═══════════════════ */
const LlmDecisionDraft = z.object({
  title: z.string(),
  domain: z.string(),
  stakes: z.enum(["low", "medium", "high"]),
  reversibility: z.enum(["reversible", "partly", "irreversible"]),
  options: z.array(z.object({ label: z.string(), upfrontCost: z.number().nullable(), monthlyCost: z.number().nullable(), timeHours: z.number().nullable() })),
  criteria: z.array(z.object({ name: z.string(), weight: z.number(), goalTitle: z.string().nullable(), rationale: z.string() })),
  scores: z.array(z.object({ option: z.number().int(), criterion: z.number().int(), score: z.number(), low: z.number(), high: z.number(), rationale: z.string() })),
  unknowns: z.array(z.object({ question: z.string(), impact: z.enum(["low", "medium", "high"]), wouldChange: z.string() })),
  risks: z.array(z.object({ text: z.string(), likelihood: z.number(), impact: z.number() })),
  secondOrder: z.array(z.object({ text: z.string(), horizon: z.string() })),
});

export const DecisionAgent = defineAgent({
  name: "DecisionAgent",
  description: "Frames decisions as transparent models and stress-tests them. Never chooses for the user.",
  responsibilities: ["Draft options, criteria and scores", "Scenario & sensitivity analysis", "Surface decisive unknowns and second-order effects"],
  input: z.object({ question: z.string().min(5).max(400) }),
  tools: ["create_decision", "analyze_decision", "search_memory", "finance_overview"],
  async run(ctx, { question }): Promise<AgentOutput> {
    const w = await ctx.world();
    const heuristic = draftDecision(w, question);
    let draft: DecisionDraft = heuristic;
    if (ctx.llm) {
      const fin = await ctx.need<FinanceSummary>("finance_overview", {});
      const mem = await ctx.need<{ content: string }[]>("search_memory", { query: question });
      const llm = await ctx.llmStructured({
        system:
          "You structure personal decisions for LIFEOS. Produce 3–4 distinct options (include a defer/alternative option), 3–5 weighted criteria tied to the user's goals where relevant (weights sum to 1), and a score 0–10 for every option×criterion with a pessimistic (low) and optimistic (high) bound and a one-line rationale. List decisive unknowns. Use only the provided context; do not recommend a choice.",
        prompt: `Question: ${question}\nGoals: ${JSON.stringify(w.goals.filter((g) => g.status === "active").map((g) => ({ title: g.title, priority: g.priority })))}\nFinances: liquid £${Math.round(fin.liquid)}, essentials £${Math.round(fin.monthlyEssentials)}/mo, runway ${fin.runwayMonths.toFixed(1)} months\nRelevant memories: ${JSON.stringify(mem.slice(0, 5).map((m) => m.content))}\nHeuristic draft to improve on: ${JSON.stringify({ options: heuristic.options, criteria: heuristic.criteria.map((c) => c.name) })}`,
        schema: LlmDecisionDraft,
        maxTokens: 8000,
      });
      if (llm && llm.options.length >= 2 && llm.criteria.length >= 2) {
        const sum = llm.criteria.reduce((a, c) => a + Math.max(0, c.weight), 0) || 1;
        draft = {
          title: llm.title,
          question,
          domain: llm.domain,
          stakes: llm.stakes,
          reversibility: llm.reversibility,
          options: llm.options.map((o) => ({ label: o.label, upfrontCost: o.upfrontCost ?? undefined, monthlyCost: o.monthlyCost ?? undefined, timeHours: o.timeHours ?? undefined })),
          criteria: llm.criteria.map((c) => ({ name: c.name, weight: Math.max(0, c.weight) / sum, rationale: c.rationale, goalId: w.goals.find((g) => g.title === c.goalTitle)?.id })),
          scores: llm.scores.filter((sc) => sc.option < llm.options.length && sc.criterion < llm.criteria.length).map((sc) => ({ ...sc, score: Math.min(10, Math.max(0, sc.score)), low: Math.min(10, Math.max(0, sc.low)), high: Math.min(10, Math.max(0, sc.high)) })),
          model: {
            ...heuristic.model,
            unknowns: llm.unknowns,
            risks: llm.risks,
            secondOrder: llm.secondOrder.map((x) => ({ ...x, provenance: "ai_inference" })),
            assumptions: [{ text: "Options, criteria and initial scores drafted by the AI model from your context — review them", provenance: "ai_inference" }],
          },
        };
      }
    }
    const created = await ctx.need<{ id: string; title: string }>("create_decision", { question, draft });
    const analysis = await ctx.need<DecisionAnalysis>("analyze_decision", { decisionId: created.id });
    const items: Insight[] = [
      insight({
        key: `decision:${created.id}:summary`,
        kind: "decision",
        title: analysis.leader ? `Current model: “${analysis.leader.label}” leads by ${analysis.leader.margin}` : "Model drafted",
        conclusion: analysis.summary,
        evidence: analysis.contextFacts.slice(0, 5),
        assumptions: ["Initial scores are estimates — adjust them in the workspace", ...(draft.model.assumptions ?? []).map((a) => a.text)],
        wouldChange: analysis.questions.slice(0, 3).map((q) => q.question),
        confidenceScore: analysis.confidence === "high" ? 0.75 : analysis.confidence === "medium" ? 0.55 : 0.35,
        severity: "info",
      }),
    ];
    return {
      summary: `I framed “${question}” as a decision model with ${draft.options.length} options and ${draft.criteria.length} weighted criteria. It isn't a recommendation — it shows what drives the outcome and which unknowns would change it.`,
      blocks: [{ type: "decision", decisionId: created.id, title: created.title }, { type: "insights", title: "First read", items }, { type: "text", title: "Questions that would materially change this", body: analysis.questions.map((q) => `• ${q.question} — ${q.why}`).join("\n") || "None identified yet." }],
    };
  },
});

/* ═══════════════════ OpportunityAgent ═══════════════════ */
export const OpportunityAgent = defineAgent({
  name: "OpportunityAgent",
  description: "Maps objectives to concrete opportunity routes and analyses fit.",
  responsibilities: ["Opportunity radar for an objective", "Fit analysis for a specific opportunity", "Record new opportunities (with approval)"],
  input: z.object({ op: z.enum(["radar", "analyze"]), objective: z.string().max(400).optional(), name: z.string().max(300).optional() }),
  tools: ["opportunity_radar", "analyze_opportunity", "create_opportunity", "rank_actions"],
  async run(ctx, input): Promise<AgentOutput> {
    if (input.op === "radar") {
      const objective = input.objective ?? "Improve my situation";
      const r = await ctx.need<{ theme: string; routes: OpportunityRoute[] }>("opportunity_radar", { objective });
      const top = r.routes[0];
      return {
        summary: await narrate(ctx, `Summarise routes towards “${objective}”`, r.routes.slice(0, 5).map((x) => ({ title: x.title, fit: x.fitScore, upside: x.upside, ev: x.expectedValueNote, next: x.nextAction })), `${r.routes.length} routes towards “${objective}” (theme: ${r.theme}). Strongest: ${top?.title ?? "none"}. Upside ranges are labelled FACT, ESTIMATE or ASSUMPTION — none are predictions.`),
        blocks: [{ type: "radar", title: `Opportunity radar · ${objective}`, routes: r.routes, objective }],
      };
    }
    const a = await ctx.need<{ opportunity: World["opportunities"][number]; fit: { score: number; matched: { name: string; have: number; need: number; evidencedBy: string[] }[]; gaps: { name: string; have: number; need: number }[]; contacts: { name: string; relation: string }[]; visaRisk: { blocked: boolean; text: string | null }; components: { factor: string; value: number; note: string }[] }; nextAction: string }>("analyze_opportunity", { name: input.name ?? input.objective ?? "" });
    const o = a.opportunity;
    const w = await ctx.world();
    const item = insight({
      key: `opp:${o.id}:analysis`,
      kind: "radar",
      title: `${o.title}: ${Math.round(a.fit.score * 100)}% fit`,
      conclusion: `${a.fit.matched.length} required skills met, ${a.fit.gaps.length} gap(s)${a.fit.visaRisk.blocked ? "; employer states no visa sponsorship" : ""}. Next: ${a.nextAction}`,
      evidence: [
        ...a.fit.matched.map((m) => ({ text: `${m.name}: ${m.have}/5 ≥ ${m.need}${m.evidencedBy.length ? ` (evidence: ${m.evidencedBy.join(", ")})` : ""}`, provenance: "fact" as const })),
        ...a.fit.gaps.map((g) => ({ text: `Gap: ${g.name} ${g.have}/5 < ${g.need}`, provenance: "fact" as const })),
        ...a.fit.contacts.map((c) => ({ text: `Contact: ${c.name} (${c.relation})`, provenance: "fact" as const })),
        ...(o.deadline ? [{ text: `Deadline ${o.deadline} (${relativeDay(o.deadline, w.now)})`, provenance: "fact" as const }] : []),
        ...(o.valueLow ? [{ text: `Value ${money(o.valueLow)}–${money(o.valueHigh)} ${o.valuePeriod?.replace("_", " ")}`, provenance: o.source === "ai_inference" ? ("estimate" as const) : ("fact" as const) }] : []),
      ],
      assumptions: ["Skill levels are self-assessed", "Requirements in the description are screened for"],
      wouldChange: ["Evidence of higher skill level", "Different visa situation", "Requirements relaxed"],
      confidenceScore: 0.7,
      scoreBreakdown: a.fit.components,
      refs: [{ type: "opportunity", id: o.id, label: o.title }],
      actions: [{ label: "Open opportunity", href: `/opportunities/${o.id}` }],
    });
    return { summary: item.conclusion, blocks: [{ type: "insights", title: "Opportunity analysis", items: [item] }] };
  },
});

/* ═══════════════════ MemoryAgent ═══════════════════ */
export const MemoryAgent = defineAgent({
  name: "MemoryAgent",
  description: "Maintains long-term memory with provenance. Proposes memories; never stores silently.",
  responsibilities: ["Recall what LIFEOS knows and where it came from", "Propose new memories for approval"],
  input: z.object({ op: z.enum(["recall", "remember"]), text: z.string().max(500) }),
  tools: ["search_memory", "create_memory"],
  async run(ctx, { op, text }): Promise<AgentOutput> {
    if (op === "recall") {
      const q = text.replace(/what do you know about me|what do you remember|about me/gi, "").trim();
      const mem = await ctx.need<{ id: string; content: string; source: string; confidence: number; category: string }[]>("search_memory", { query: q });
      return { summary: `${mem.length} memories${q ? ` related to “${q}”` : ""}. Each shows its source and confidence — open Knowledge → Memory to correct or delete any of them.`, blocks: [{ type: "memories", title: "What LIFEOS remembers", items: mem }] };
    }
    const content = text.replace(/^(please\s+)?(remember|note)( that)?\s*/i, "").trim();
    const category = /\b(prefer|like|love|hate|rather|want)\b/i.test(content) ? "preference" : /\b(learn(ed|t)|lesson|next time|never again)\b/i.test(content) ? "lesson" : /\b(can't|cannot|must|need to|only|no more than|at least)\b/i.test(content) ? "constraint" : "fact";
    const payload = { content: content.charAt(0).toUpperCase() + content.slice(1), category, source: "user_input", confidence: 0.95, importance: 3 };
    const r = await ctx.tool("create_memory", payload);
    const b = approvalBlock(r as never, "create_memory", payload);
    return { summary: `Proposed a ${category} memory. It's stored only if you approve.`, blocks: b ? [b] : [] };
  },
});

/* ═══════════════════ ProjectAgent ═══════════════════ */
function parseDue(text: string, now: Date): string | undefined {
  const t = text.toLowerCase();
  const add = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString().slice(0, 10);
  if (/\btoday\b/.test(t)) return add(0);
  if (/\btomorrow\b/.test(t)) return add(1);
  const m = t.match(/\bin (\d+) days?\b/);
  if (m) return add(Number(m[1]));
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dn = days.findIndex((d) => t.includes(d));
  if (dn >= 0) return add(((dn - now.getUTCDay() + 7) % 7) || 7);
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return iso?.[1];
}

export const ProjectAgent = defineAgent({
  name: "ProjectAgent",
  description: "Moves projects forward with concrete, smallest-next-action plans.",
  responsibilities: ["Project autopilot plans", "Find unfinished/stalled projects", "Propose tasks and evidence links (with approval)", "Break down stuck tasks"],
  input: z.object({ op: z.enum(["autopilot", "list", "create_task", "link_evidence", "breakdown"]), projectId: z.string().uuid().optional(), text: z.string().max(500).default("") }),
  tools: ["get_project", "list_projects", "move_project_forward", "create_task", "link_entities", "what_am_i_missing"],
  async run(ctx, input): Promise<AgentOutput> {
    const w = await ctx.world();
    if (input.op === "list") {
      const filter = /stall|stuck|stale/i.test(input.text) ? "stalled" : "unfinished";
      const list = await ctx.need<{ id: string; title: string; status: string; progress: number; openTasks: number; idleDays: number; due: string | null }[]>("list_projects", { filter });
      return {
        summary: `${list.length} ${filter} project(s). ${list.filter((p) => p.progress >= 0.7).length} are 70%+ done — finishing those is usually the highest-leverage move.`,
        blocks: [{ type: "entities", title: `${filter === "stalled" ? "Stalled" : "Unfinished"} projects`, items: list.map((p) => ({ type: "project" as const, id: p.id, label: p.title, subtitle: `${p.status} · ${p.openTasks} open tasks`, meta: `${Math.round(p.progress * 100)}%`, reason: p.idleDays >= 7 ? `idle ${p.idleDays} days` : p.due ? `due ${p.due}` : undefined })) }],
      };
    }
    const project = input.projectId ? w.idx.project.get(input.projectId) : findByText(w.projects.filter((p) => p.status !== "done"), (p) => p.title, input.text);
    if (input.op === "create_task") {
      const title = input.text.replace(/^(please\s+)?(create|add)( a)? task( to)?\s*|^remind me to\s*/i, "").replace(/\s+((by|due|on)\s+)?(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{4}-\d{2}-\d{2}|in \d+ days?)\b.*$/i, "").trim();
      const payload = { title: title.charAt(0).toUpperCase() + title.slice(1), projectId: project?.id, dueDate: parseDue(input.text, w.now), goalId: project?.goalId ?? undefined };
      const r = await ctx.tool("create_task", Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
      const b = approvalBlock(r as never, "create_task", payload);
      return { summary: `Proposed task “${payload.title}”${project ? ` in ${project.title}` : ""}${payload.dueDate ? `, due ${payload.dueDate}` : ""}.`, blocks: b ? [b] : [{ type: "text", body: "error" in r ? String(r.error) : "Could not create task" }] };
    }
    if (input.op === "breakdown") {
      const task = findByText(w.tasks.filter((t) => t.status !== "done"), (t) => t.title, input.text);
      if (!task) return { summary: "I couldn't find that task.", blocks: [] };
      const first = /read/i.test(task.title) ? `Read the first section of “${task.title}” and write 5 flashcards` : /module|course/i.test(task.title) ? `Do the first lesson of “${task.title}” (25 min)` : `Spend 25 minutes producing the first output for “${task.title}”`;
      const payload = { title: first, projectId: task.projectId ?? undefined, goalId: task.goalId ?? undefined, estimateMinutes: 25, dueDate: parseDue("tomorrow", w.now) };
      const r = await ctx.tool("create_task", Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined)));
      const b = approvalBlock(r as never, "create_task", payload);
      return {
        summary: `“${task.title}” has been postponed ${task.postponedCount} times. The fix is a first step small enough to start without willpower.`,
        blocks: [
          { type: "plan", title: `Break down: ${task.title}`, steps: [{ title: first, detail: "Schedule it for tomorrow morning, before email.", minutes: 25, why: "Removes the activation barrier", kind: "do" }, { title: "Decide the second step only after the first is done", detail: "Avoid re-planning the whole task.", why: "Momentum over planning", kind: "decide" }] },
          ...(b ? [b] : []),
        ],
      };
    }
    if (!project) return { summary: "Which project? I couldn't match one in your request.", blocks: [{ type: "entities", title: "Active projects", items: w.projects.filter((p) => p.status !== "done").map((p) => refOf(w, "project", p.id)) }] };
    if (input.op === "link_evidence") {
      const missing = await ctx.need<Insight[]>("what_am_i_missing", {});
      const target = missing.find((m) => m.detector === "unlinkedEvidence" && m.refs?.[0]?.id === project.id);
      const opps = (target?.refs ?? []).filter((r) => r.type === "opportunity").slice(0, 3);
      const blocks: ResultBlock[] = [];
      for (const o of opps) {
        const payload = { fromType: "project", fromId: project.id, toType: "opportunity", toId: o.id, relation: "supports", rationale: `Project evidences skills required by ${o.label}` };
        const b = approvalBlock((await ctx.tool("link_entities", payload)) as never, "link_entities", payload);
        if (b) blocks.push(b);
      }
      return { summary: opps.length ? `Proposed ${opps.length} evidence link(s) from “${project.title}”.` : `“${project.title}” is already linked to the opportunities it supports.`, blocks };
    }
    const plan = await ctx.need<AutopilotPlan>("move_project_forward", { projectId: project.id });
    const fallback = plan.smallestNextAction ? `Smallest useful next action: ${plan.smallestNextAction.title}${plan.smallestNextAction.minutes ? ` (${plan.smallestNextAction.minutes} min)` : ""}. ${plan.eta === "complete" ? "" : `ETA ${plan.eta}.`}` : plan.rationale;
    return {
      summary: await narrate(ctx, "Explain the project plan, leading with the smallest useful next action", { project: plan.title, state: plan.state, smallest: plan.smallestNextAction, blockers: plan.blockers, eta: plan.eta }, fallback),
      blocks: [
        { type: "plan", title: `Move “${plan.title}” forward`, steps: plan.smallestNextAction ? [plan.smallestNextAction, ...plan.steps.filter((s) => s.title !== plan.smallestNextAction!.title)] : plan.steps, rationale: plan.rationale },
        ...(plan.risks.length ? [{ type: "insights" as const, title: "Risks", items: plan.risks }] : []),
        { type: "entities", title: "Open project", items: [refOf(w, "project", plan.projectId)] },
      ],
    };
  },
});

/* ═══════════════════ FinanceAgent ═══════════════════ */
export const FinanceAgent = defineAgent({
  name: "FinanceAgent",
  description: "Explains the user's financial position and money scenarios. Gives no investment advice.",
  responsibilities: ["Cash, runway, spending patterns", "Spend/earn simulations"],
  input: z.object({ op: z.enum(["overview", "simulate"]), question: z.string().max(500).optional(), overrides: z.record(z.string(), z.number()).optional() }),
  tools: ["finance_overview", "calculate_scenario"],
  async run(ctx, input): Promise<AgentOutput> {
    if (input.op === "simulate") {
      const sim = await ctx.need<SimulationResult>("calculate_scenario", { question: input.question ?? "", overrides: input.overrides ?? {} });
      return { summary: sim.headline, blocks: [{ type: "simulation", result: sim }] };
    }
    const f = await ctx.need<FinanceSummary>("finance_overview", {});
    return {
      summary: `Runway ≈ ${f.runwayMonths.toFixed(1)} months on essentials. You're ${f.monthlyNet >= 0 ? "saving" : "spending"} about ${money(Math.abs(f.monthlyNet))}/month ${f.monthlyNet >= 0 ? "net" : "more than you earn"} (90-day average). Not financial advice — a description of your recorded data.`,
      blocks: [
        {
          type: "metrics",
          title: "Financial position",
          items: [
            { label: "Liquid cash", value: money(f.liquid), provenance: "fact" },
            { label: "Monthly income (avg)", value: money(f.monthlyIncome), provenance: "estimate", hint: "90-day average" },
            { label: "Monthly spending (avg)", value: money(f.monthlyExpenses), provenance: "estimate" },
            { label: "Essentials", value: money(f.monthlyEssentials), provenance: "estimate" },
            { label: "Runway", value: `${f.runwayMonths.toFixed(1)} months`, provenance: "estimate", hint: "liquid ÷ essentials" },
            { label: "Net worth", value: money(f.netWorth), provenance: "estimate" },
          ],
        },
        { type: "text", title: "Recurring costs", body: f.recurring.map((r) => `• ${r.description}: ${money(r.monthly)}/month`).join("\n") },
      ],
    };
  },
});

/* ═══════════════════ ReflectionAgent ═══════════════════ */
export const ReflectionAgent = defineAgent({
  name: "ReflectionAgent",
  description: "Finds blind spots, explains recommendations and summarises change.",
  responsibilities: ["What am I missing?", "What changed?", "Explain why something was recommended", "Find missing information"],
  input: z.object({ op: z.enum(["missing", "changes", "explain", "missing_info"]), text: z.string().max(500).default(""), days: z.number().int().min(1).max(90).optional() }),
  tools: ["what_am_i_missing", "what_changed", "rank_actions", "analyze_decision"],
  async run(ctx, input): Promise<AgentOutput> {
    const w = await ctx.world();
    if (input.op === "missing") {
      const items = await ctx.need<Insight[]>("what_am_i_missing", {});
      const critical = items.filter((i) => i.severity === "critical" || i.severity === "important");
      return {
        summary: await narrate(ctx, "Summarise the most important blind spots", critical.slice(0, 6).map((i) => ({ title: i.title, why: i.conclusion })), `${items.length} potential blind spots from ${Object.keys(DETECTORS).length} detectors; ${critical.length} look important. Every one cites the records it's based on — dismiss any that are wrong.`),
        blocks: [{ type: "insights", title: "What you might be missing", items }],
      };
    }
    if (input.op === "changes") {
      const days = input.days ?? (/month/i.test(input.text) ? 30 : 7);
      const changes = await ctx.need<ChangeItem[]>("what_changed", { days });
      return {
        summary: `${changes.length} changes in the last ${days} days: ${changes.filter((c) => c.kind === "completed").length} completions, ${changes.filter((c) => c.kind === "created").length} new items, ${changes.filter((c) => c.kind === "message").length} messages, ${changes.filter((c) => c.kind === "status").length} status changes.`,
        blocks: [{ type: "entities", title: `What changed (last ${days} days)`, items: changes.map((c) => ({ type: (c.entityType === "admin" || c.entityType === "integration" ? "note" : c.entityType) as never, id: c.entityId ?? "", label: c.summary, subtitle: c.kind, meta: relativeDay(c.at, w.now) })) }],
      };
    }
    if (input.op === "missing_info") {
      const items: Insight[] = [];
      for (const d of w.decisions.filter((d) => d.status !== "decided")) {
        const a = await ctx.need<DecisionAnalysis>("analyze_decision", { decisionId: d.id });
        if (a.questions.length)
          items.push(insight({ key: `info:${d.id}`, kind: "decision", title: `${d.title}: ${a.questions.length} open question(s)`, conclusion: a.questions.slice(0, 2).map((q) => q.question).join(" "), evidence: a.missingInfo.slice(0, 3).map((m) => ({ text: m.item, provenance: "ai_inference" as const })), confidenceScore: 0.7, refs: [{ type: "decision", id: d.id, label: d.title }], actions: [{ label: "Open decision", href: `/decisions/${d.id}` }] }));
      }
      const lowConf = w.documentFields.filter((f) => f.confidence < 0.6 && !f.verified);
      if (lowConf.length)
        items.push(insight({ key: "info:docfields", kind: "blind_spot", title: `${lowConf.length} document fields need verification`, conclusion: "These were extracted with low confidence. Verify or correct them so downstream insights stay accurate.", evidence: lowConf.slice(0, 6).map((f) => ({ text: `${f.label} = ${f.value.slice(0, 60)} (${Math.round(f.confidence * 100)}%)`, provenance: "fact" as const, ref: { type: "document" as const, id: f.documentId, label: w.idx.document.get(f.documentId)?.title ?? "" } })), confidenceScore: 0.8 }));
      const noMetric = w.goals.filter((g) => g.status === "active" && (g.targetValue === null || !g.targetDate));
      if (noMetric.length) items.push(insight({ key: "info:goals", kind: "blind_spot", title: `${noMetric.length} goals lack a measurable target`, conclusion: "Without a target value and date LIFEOS can't measure progress.", evidence: noMetric.map((g) => ({ text: g.title, provenance: "user_input" as const, ref: { type: "goal" as const, id: g.id, label: g.title } })), confidenceScore: 0.9 }));
      const noEstimate = w.tasks.filter((t) => !["done", "cancelled"].includes(t.status) && !t.estimateMinutes);
      if (noEstimate.length) items.push(insight({ key: "info:estimates", kind: "blind_spot", title: `${noEstimate.length} open tasks have no time estimate`, conclusion: "Estimates power leverage scoring and project ETAs.", evidence: noEstimate.slice(0, 6).map((t) => ({ text: t.title, provenance: "fact" as const, ref: { type: "task" as const, id: t.id, label: t.title } })), confidenceScore: 0.9 }));
      return { summary: `${items.length} areas where missing information limits the analysis.`, blocks: [{ type: "insights", title: "Missing information", items }] };
    }
    // explain
    const actions = await ctx.need<Insight[]>("rank_actions", { limit: 20 });
    const missing = await ctx.need<Insight[]>("what_am_i_missing", {});
    const all = [...actions, ...missing];
    const q = input.text.replace(/explain( why)?|why did you recommend|why (is|was)|recommend(ed|ation)?/gi, "").trim();
    const qv = localEmbed(q || "top recommendation");
    const best = q ? [...all].sort((a, b) => cosine(qv, localEmbed(`${b.title} ${b.conclusion}`)) - cosine(qv, localEmbed(`${a.title} ${a.conclusion}`)))[0] : actions[0];
    if (!best) return { summary: "There are no current recommendations to explain.", blocks: [] };
    return {
      summary: `Here's the full reasoning for “${best.title}”: the evidence, the assumptions, how confident LIFEOS is, and what would change it.`,
      blocks: [{ type: "insights", title: "Explanation", items: [best] }],
    };
  },
});

/* ═══════════════════ OutreachAgent ═══════════════════ */
export const OutreachAgent = defineAgent({
  name: "OutreachAgent",
  description: "Drafts messages grounded in your history and proposes sending them — never sends on its own.",
  responsibilities: ["Draft replies, follow-ups and check-ins", "Propose sends via the approval queue"],
  input: z.object({ text: z.string().max(500) }),
  tools: ["draft_message", "send_message", "what_am_i_missing"],
  async run(ctx, { text }): Promise<AgentOutput> {
    const w = await ctx.world();
    let targets: { personId: string; purpose: string }[] = [];
    const person = findByText(w.people, (p) => p.name, text) ?? findByText(w.people, (p) => p.name.split(" ")[0], text);
    if (person) targets = [{ personId: person.id, purpose: /follow/i.test(text) ? "follow-up" : /check[- ]?in/i.test(text) ? "Would love to catch up properly soon." : "reply" }];
    else if (/follow[- ]?ups?|stale applications/i.test(text)) {
      for (const a of w.applications.filter((a) => a.status === "submitted" && !a.lastFollowUpAt)) {
        const o = w.idx.opportunity.get(a.opportunityId);
        const contact = o?.contactPersonId ?? w.people.find((p) => p.companyId === o?.companyId)?.id;
        if (contact) targets.push({ personId: contact, purpose: "follow-up" });
      }
    }
    if (!targets.length) return { summary: "Who should the message go to? Mention a name (e.g. “Draft a reply to Priya”).", blocks: [] };
    const blocks: ResultBlock[] = [];
    for (const t of targets.slice(0, 3)) {
      const draft = await ctx.need<{ to: string; channel: string; subject: string; body: string; grounding: string[] }>("draft_message", t);
      let body = draft.body;
      if (ctx.llm) {
        const improved = await ctx.llmStructured({
          system: "Improve this short professional message. Keep every fact; add none. British English, warm and concise, under 120 words. Return only the message body.",
          prompt: `Context facts: ${JSON.stringify(draft.grounding)}\nDraft:\n${draft.body}`,
          schema: z.object({ body: z.string() }),
          maxTokens: 1500,
        });
        if (improved?.body) body = improved.body;
      }
      blocks.push({ type: "text", title: `Draft to ${draft.to} (${draft.channel})`, body: `${draft.subject ? `Subject: ${draft.subject}\n\n` : ""}${body}\n\n— Grounded in: ${draft.grounding.join("; ")}` });
      const payload = { personId: t.personId, channel: draft.channel === "email" ? "email" : draft.channel === "whatsapp" ? "whatsapp" : "linkedin", subject: draft.subject, body };
      const b = approvalBlock((await ctx.tool("send_message", payload)) as never, "send_message", payload);
      if (b) blocks.push(b);
    }
    return { summary: `Drafted ${Math.min(3, targets.length)} message(s). Nothing is sent until you approve each one.`, blocks };
  },
});

export const AGENTS = { ResearchAgent, PlannerAgent, DocumentAgent, DecisionAgent, OpportunityAgent, MemoryAgent, ProjectAgent, FinanceAgent, ReflectionAgent, OutreachAgent };
