/**
 * Decision Engine.
 *
 * Builds a transparent multi-criteria model and stress-tests it. It deliberately does NOT tell the
 * user what to choose: it shows which option leads under which assumptions, how fragile that lead
 * is, and which unknowns would change it.
 */
import { clamp, daysUntil, hours, money, pct, relativeDay } from "@/lib/format";
import type { Evidence } from "@/lib/types";
import { cosine, localEmbed } from "@/server/ai/embeddings";
import type { DecisionModelExtras } from "@/server/db/schema";
import { financeSummary, goalProgress } from "./signals";
import type { World } from "./world";

export interface DecisionInput {
  decision: World["decisions"][number];
  options: World["decisionOptions"];
  criteria: World["decisionCriteria"];
  scores: World["decisionScores"];
}

export interface OptionResult {
  optionId: string;
  label: string;
  base: number;
  worst: number;
  best: number;
  rankBase: number;
  contributions: { criterion: string; weighted: number; score: number }[];
}

export interface SensitivityItem {
  criterion: string;
  weight: number;
  /** weight at which the base-case leader changes (null = never within 0..2× weight) */
  flipAt: number | null;
  flipTo: string | null;
  marginLow: number; // leader margin at 0.5× weight
  marginHigh: number; // leader margin at 1.5× weight
}

export interface DecisionAnalysis {
  options: OptionResult[];
  leader: { label: string; margin: number; robust: boolean } | null;
  robustOption: { label: string; worst: number } | null;
  upsideOption: { label: string; best: number } | null;
  scenarios: { name: "Pessimistic" | "Base" | "Optimistic"; ranking: { label: string; score: number }[] }[];
  sensitivity: SensitivityItem[];
  scoreSwings: { option: string; criterion: string; detail: string }[];
  missingInfo: { item: string; why: string }[];
  questions: { question: string; why: string; impact: "low" | "medium" | "high" }[];
  secondOrder: { text: string; horizon: string; provenance: string }[];
  contextFacts: Evidence[];
  lessons: { text: string; similarity: number; source: string }[];
  quality: { check: string; ok: boolean; hint: string }[];
  confidence: "low" | "medium" | "high";
  summary: string;
}

function normWeights(criteria: World["decisionCriteria"], override?: Record<string, number>) {
  const ws = criteria.map((c) => Math.max(0, override?.[c.id] ?? c.weight));
  const sum = ws.reduce((a, b) => a + b, 0) || 1;
  return new Map(criteria.map((c, i) => [c.id, ws[i] / sum]));
}

function totals(input: DecisionInput, kind: "score" | "low" | "high", override?: Record<string, number>) {
  const weights = normWeights(input.criteria, override);
  return input.options.map((o) => {
    let total = 0;
    for (const c of input.criteria) {
      const s = input.scores.find((x) => x.optionId === o.id && x.criterionId === c.id);
      const v = s ? (kind === "score" ? s.score : (s[kind] ?? s.score)) : 5;
      total += v * (weights.get(c.id) ?? 0);
    }
    return { optionId: o.id, label: o.label, total };
  });
}

function leaderOf(rows: { label: string; total: number }[]) {
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  return { leader: sorted[0], runnerUp: sorted[1], margin: sorted[0] && sorted[1] ? sorted[0].total - sorted[1].total : 0 };
}

export function analyzeDecision(w: World, input: DecisionInput): DecisionAnalysis {
  const { decision, options, criteria } = input;
  const extras = (decision.model ?? {}) as DecisionModelExtras;
  const weights = normWeights(criteria);

  const base = totals(input, "score");
  const worst = totals(input, "low");
  const best = totals(input, "high");
  const ranked = [...base].sort((a, b) => b.total - a.total);
  const results: OptionResult[] = options.map((o) => {
    const b = base.find((x) => x.optionId === o.id)!.total;
    return {
      optionId: o.id,
      label: o.label,
      base: Number(b.toFixed(2)),
      worst: Number(worst.find((x) => x.optionId === o.id)!.total.toFixed(2)),
      best: Number(best.find((x) => x.optionId === o.id)!.total.toFixed(2)),
      rankBase: ranked.findIndex((r) => r.optionId === o.id) + 1,
      contributions: criteria.map((c) => {
        const s = input.scores.find((x) => x.optionId === o.id && x.criterionId === c.id)?.score ?? 5;
        return { criterion: c.name, score: s, weighted: Number((s * (weights.get(c.id) ?? 0)).toFixed(2)) };
      }),
    };
  });

  const L = leaderOf(base);
  const worstLeader = leaderOf(worst).leader;
  const bestLeader = leaderOf(best).leader;

  // Weight sensitivity: scan each criterion's weight from 0 to 2× and find where the leader flips.
  const sensitivity: SensitivityItem[] = criteria.map((c) => {
    let flipAt: number | null = null;
    let flipTo: string | null = null;
    const steps = 40;
    let closest = Infinity;
    for (let i = 0; i <= steps; i++) {
      const wv = (c.weight * 2 * i) / steps;
      const lead = leaderOf(totals(input, "score", { [c.id]: wv })).leader;
      if (L.leader && lead.label !== L.leader.label) {
        const dist = Math.abs(wv - c.weight);
        if (dist < closest) {
          closest = dist;
          flipAt = Number(wv.toFixed(3));
          flipTo = lead.label;
        }
      }
    }
    const marginAt = (mult: number) => leaderOf(totals(input, "score", { [c.id]: c.weight * mult })).margin;
    return { criterion: c.name, weight: Number((weights.get(c.id) ?? 0).toFixed(3)), flipAt, flipTo, marginLow: Number(marginAt(0.5).toFixed(2)), marginHigh: Number(marginAt(1.5).toFixed(2)) };
  });

  // Score swings: does any single uncertain score (low/high) flip the leader?
  const scoreSwings: DecisionAnalysis["scoreSwings"] = [];
  for (const s of input.scores) {
    for (const kind of ["low", "high"] as const) {
      const v = s[kind];
      if (v === null || v === s.score) continue;
      const alt = input.scores.map((x) => (x === s ? { ...x, score: v } : x));
      const lead = leaderOf(totals({ ...input, scores: alt }, "score")).leader;
      if (L.leader && lead.label !== L.leader.label) {
        const o = options.find((x) => x.id === s.optionId)!;
        const c = criteria.find((x) => x.id === s.criterionId)!;
        scoreSwings.push({ option: o.label, criterion: c.name, detail: `If “${o.label}” scores ${v} (not ${s.score}) on ${c.name}, “${lead.label}” takes the lead.` });
      }
    }
  }

  // Missing information
  const missingInfo: DecisionAnalysis["missingInfo"] = [];
  for (const o of options)
    for (const c of criteria)
      if (!input.scores.some((s) => s.optionId === o.id && s.criterionId === c.id)) missingInfo.push({ item: `No score for “${o.label}” on ${c.name}`, why: "Treated as neutral (5/10); this can hide a real difference." });
  for (const s of input.scores) {
    if (s.low !== null && s.high !== null && s.high - s.low >= 4) {
      const o = options.find((x) => x.id === s.optionId)!;
      const c = criteria.find((x) => x.id === s.criterionId)!;
      missingInfo.push({ item: `Wide uncertainty: “${o.label}” on ${c.name} (${s.low}–${s.high})`, why: "A narrower estimate would make the comparison more reliable." });
    }
  }
  for (const o of options) if (o.upfrontCost === null && o.monthlyCost === null && decision.domain === "purchase") missingInfo.push({ item: `Cost of “${o.label}” not recorded`, why: "Purchases should be compared on total cost of ownership." });

  // Questions that would materially change the decision
  const questions: DecisionAnalysis["questions"] = [
    ...(extras.unknowns ?? []).map((u) => ({ question: u.question, why: u.wouldChange ?? "Flagged as an open unknown when the decision was framed.", impact: u.impact })),
    ...sensitivity
      .filter((s) => s.flipAt !== null && Math.abs((s.flipAt ?? 0) - (criteria.find((c) => c.name === s.criterion)?.weight ?? 0)) < (criteria.find((c) => c.name === s.criterion)?.weight ?? 1) * 0.6)
      .map((s) => ({ question: `How much does “${s.criterion}” really matter to you right now?`, why: `If its weight moves to ${pct(s.flipAt ?? 0)} (raw), “${s.flipTo}” overtakes the current leader.`, impact: "high" as const })),
    ...scoreSwings.slice(0, 2).map((x) => ({ question: `How confident are you in “${x.option}” on ${x.criterion}?`, why: x.detail, impact: "medium" as const })),
  ];

  // Second-order effects (engine-derived + framed)
  const fin = financeSummary(w);
  const secondOrder: DecisionAnalysis["secondOrder"] = [...(extras.secondOrder ?? [])];
  const contextFacts: Evidence[] = [];
  for (const o of options) {
    if (o.upfrontCost && o.upfrontCost > 0 && fin.monthlyEssentials > 0) {
      const runwayLoss = o.upfrontCost / fin.monthlyEssentials;
      secondOrder.push({ text: `“${o.label}” reduces runway by ~${runwayLoss.toFixed(1)} months (${money(o.upfrontCost)} of ${money(fin.liquid)} liquid).`, horizon: "immediate", provenance: "estimate" });
    }
    if (o.monthlyCost && o.monthlyCost > 0) secondOrder.push({ text: `“${o.label}” adds ${money(o.monthlyCost)}/month — ${money(o.monthlyCost * 12)}/year — to fixed costs.`, horizon: "12 months", provenance: "estimate" });
    if (o.timeHours && o.timeHours > 0) {
      const weeks = o.timeHours / Math.max(1, w.settings.focusHoursPerWeek);
      secondOrder.push({ text: `“${o.label}” consumes ~${hours(o.timeHours * 60)} ≈ ${weeks.toFixed(1)} weeks of your ${w.settings.focusHoursPerWeek}h/week focus capacity.`, horizon: "next weeks", provenance: "estimate" });
    }
  }
  contextFacts.push({ text: `Liquid cash ${money(fin.liquid)}; essential costs ≈ ${money(fin.monthlyEssentials)}/month; runway ≈ ${fin.runwayMonths.toFixed(1)} months`, provenance: "estimate" });
  for (const c of criteria.filter((c) => c.linkedGoalId)) {
    const g = w.idx.goal.get(c.linkedGoalId!);
    if (!g) continue;
    const gp = goalProgress(g);
    contextFacts.push({ text: `“${c.name}” protects goal “${g.title}” (priority ${g.priority}/5${gp !== null ? `, ${Math.round(gp * 100)}% progress` : ""})`, provenance: "fact", ref: { type: "goal", id: g.id, label: g.title } });
  }
  const horizonEvents = w.events.filter((e) => {
    const d = daysUntil(e.startsAt, w.now);
    return d !== null && d >= 0 && d <= 75 && ["exam", "interview"].includes(e.kind);
  });
  for (const e of horizonEvents) contextFacts.push({ text: `${e.title} ${relativeDay(e.startsAt, w.now)} — competes for time and attention`, provenance: "fact", ref: { type: "event", id: e.id, label: e.title } });
  for (const f of extras.facts ?? []) contextFacts.push({ text: f.text, provenance: (f.provenance as Evidence["provenance"]) ?? "user_input" });

  // Lessons from past decisions & memory (semantic match)
  const qv = localEmbed(`${decision.title} ${decision.question} ${decision.context ?? ""}`);
  const lessons = [
    ...w.decisions.filter((d) => d.id !== decision.id && d.lessons).map((d) => ({ text: d.lessons!, source: `Decision: ${d.title}`, v: localEmbed(`${d.title} ${d.question} ${d.lessons}`) })),
    ...w.memories.filter((m) => m.status === "active" && m.category === "lesson").map((m) => ({ text: m.content, source: `Memory (${m.source.replace("_", " ")})`, v: localEmbed(m.content) })),
  ]
    .map((l) => ({ text: l.text, source: l.source, similarity: Number(cosine(qv, l.v).toFixed(3)) }))
    .filter((l) => l.similarity > 0.08)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 3);

  const quality = [
    { check: "At least three options considered", ok: options.length >= 3, hint: "Adding a ‘wait/defer’ or hybrid option often reveals a better path." },
    { check: "Criteria weighted explicitly", ok: criteria.length >= 2, hint: "Make trade-offs explicit." },
    { check: "Unknowns written down", ok: (extras.unknowns ?? []).length > 0, hint: "List what you don't know before deciding." },
    { check: "Reversibility assessed", ok: !!decision.reversibility, hint: "Reversible decisions deserve less analysis." },
    { check: "Review date set", ok: !!decision.reviewOn || decision.status !== "decided", hint: "Schedule a review to learn from the outcome." },
    { check: "Scores carry uncertainty ranges", ok: input.scores.every((s) => s.low !== null && s.high !== null), hint: "Ranges power the scenario analysis." },
  ];

  const robust = !!L.leader && worstLeader?.label === L.leader.label && bestLeader?.label === L.leader.label && !sensitivity.some((s) => s.flipAt !== null && Math.abs(s.flipAt - (criteria.find((c) => c.name === s.criterion)?.weight ?? 0)) < 0.1);
  const confidenceScore = clamp(0.35 + (L.margin / 3) * 0.4 + (robust ? 0.2 : 0) - missingInfo.length * 0.03);
  const confidence = confidenceScore >= 0.7 ? "high" : confidenceScore >= 0.45 ? "medium" : "low";

  const summary = L.leader
    ? `On your current weights, “${L.leader.label}” leads by ${L.margin.toFixed(2)} points. ${robust ? "It also leads in pessimistic and optimistic scenarios, so the result is fairly robust." : `The lead is fragile: ${worstLeader?.label !== L.leader.label ? `“${worstLeader?.label}” wins the pessimistic case` : bestLeader?.label !== L.leader.label ? `“${bestLeader?.label}” wins the optimistic case` : "small weight changes flip it"}.`} ${decision.reversibility === "reversible" ? "The decision is reversible, so speed matters more than precision." : decision.reversibility === "irreversible" ? "It's hard to reverse — resolve the high-impact unknowns first." : ""}`
    : "Add options and criteria to analyse this decision.";

  return {
    options: results.sort((a, b) => a.rankBase - b.rankBase),
    leader: L.leader ? { label: L.leader.label, margin: Number(L.margin.toFixed(2)), robust } : null,
    robustOption: worstLeader ? { label: worstLeader.label, worst: Number(worstLeader.total.toFixed(2)) } : null,
    upsideOption: bestLeader ? { label: bestLeader.label, best: Number(bestLeader.total.toFixed(2)) } : null,
    scenarios: [
      { name: "Pessimistic", ranking: worst.sort((a, b) => b.total - a.total).map((r) => ({ label: r.label, score: Number(r.total.toFixed(2)) })) },
      { name: "Base", ranking: [...base].sort((a, b) => b.total - a.total).map((r) => ({ label: r.label, score: Number(r.total.toFixed(2)) })) },
      { name: "Optimistic", ranking: best.sort((a, b) => b.total - a.total).map((r) => ({ label: r.label, score: Number(r.total.toFixed(2)) })) },
    ],
    sensitivity: sensitivity.sort((a, b) => Math.abs(b.marginHigh - b.marginLow) - Math.abs(a.marginHigh - a.marginLow)),
    scoreSwings: scoreSwings.slice(0, 6),
    missingInfo: missingInfo.slice(0, 8),
    questions: questions.slice(0, 6),
    secondOrder,
    contextFacts,
    lessons,
    quality,
    confidence,
    summary,
  };
}

/* ───────────────────────────── drafting a new decision ───────────────────────────── */

export interface DecisionDraft {
  title: string;
  question: string;
  domain: string;
  stakes: "low" | "medium" | "high";
  reversibility: "reversible" | "partly" | "irreversible";
  options: { label: string; upfrontCost?: number; monthlyCost?: number; timeHours?: number; risk?: number }[];
  criteria: { name: string; weight: number; goalId?: string; rationale: string }[];
  scores: { option: number; criterion: number; score: number; low: number; high: number; rationale: string }[];
  model: DecisionModelExtras;
}

function detectDomain(q: string): string {
  if (/\b(which|what) project\b|work on/i.test(q)) return "project";
  if (/\b(job|offer|role|contract|position|take this|accept)\b/i.test(q)) return "career";
  if (/\b(course|bootcamp|study|learn|certif|exam|degree)\b/i.test(q)) return "learning";
  if (/\b(buy|purchase|spend|car|laptop|phone|£|\$)\b/i.test(q)) return "purchase";
  if (/\b(save|invest|move|rent|flat|loan)\b/i.test(q)) return "finance";
  return "general";
}

function extractAmount(q: string): number | null {
  const m = q.match(/£\s?([\d,]+(?:\.\d+)?)\s?(k)?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ""));
  return m[2] ? n * 1000 : n;
}

function subjectOf(q: string): string {
  const m = q.match(/should i\s+(.+?)\??$/i);
  let s = (m ? m[1] : q).replace(/\?$/, "").trim();
  s = s.replace(/^(really\s+)/i, "");
  return s.length > 70 ? `${s.slice(0, 67)}…` : s;
}

export function draftDecision(w: World, question: string): DecisionDraft {
  const domain = detectDomain(question);
  const amount = extractAmount(question);
  const fin = financeSummary(w);
  const subject = subjectOf(question);
  const goalsActive = w.goals.filter((g) => g.status === "active");
  const goalFor = (cat: string | RegExp) => goalsActive.filter((g) => (typeof cat === "string" ? g.category === cat : cat.test(g.title))).sort((a, b) => b.priority - a.priority)[0];
  const qv = localEmbed(question);
  const mostRelevantGoal = [...goalsActive].sort((a, b) => cosine(qv, localEmbed(`${b.title} ${b.description ?? ""}`)) - cosine(qv, localEmbed(`${a.title} ${a.description ?? ""}`)))[0];

  let options: DecisionDraft["options"];
  if (domain === "project") {
    options = w.projects
      .filter((p) => p.status === "active" || p.status === "blocked")
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 3)
      .map((p) => ({ label: p.title, timeHours: Math.round(((w.idx.tasksByProject.get(p.id) ?? []).filter((t) => t.status !== "done").reduce((a, t) => a + (t.estimateMinutes ?? 60), 0) / 60) * 10) / 10 }));
  } else if (/\bor\b/i.test(subject) && domain !== "career") {
    options = subject.split(/\s+or\s+/i).slice(0, 3).map((s) => ({ label: s.replace(/^(to\s+)/i, "").trim() }));
  } else if (domain === "career") {
    options = [{ label: `Yes — ${subject}` }, { label: "Negotiate better terms first" }, { label: "Decline and keep current path" }];
  } else {
    options = [
      { label: `Yes — ${subject}`, upfrontCost: amount ?? undefined },
      { label: amount ? "Cheaper or free alternative" : "Smaller first step / trial", upfrontCost: amount ? Math.round(amount * 0.2) : undefined },
      { label: "Wait 30 days and revisit", upfrontCost: 0 },
    ];
  }

  const criteria: DecisionDraft["criteria"] = [];
  const pushC = (name: string, weight: number, goal: World["goals"][number] | undefined, rationale: string) => criteria.push({ name, weight, goalId: goal?.id, rationale });
  if (domain === "purchase" || domain === "finance" || amount) {
    pushC("Cost & runway", 0.3, goalFor("finance"), `Runway ≈ ${fin.runwayMonths.toFixed(1)} months; spending protects it`);
  }
  if (domain === "learning" || domain === "career" || domain === "project") pushC("Career impact", 0.35, goalFor("career"), "Serves your top-priority career goal");
  if (domain === "project") {
    pushC("Effort to finish", 0.25, undefined, "Finishing beats starting");
    pushC("Time to impact", 0.2, undefined, "Value delivered soon matters during a job search");
  }
  if (domain !== "project") pushC("Time & focus cost", 0.2, goalFor("learning"), `Competes with ${w.settings.focusHoursPerWeek}h/week focus capacity`);
  pushC("Fit with current goals", 0.2, mostRelevantGoal, mostRelevantGoal ? `Most related goal: ${mostRelevantGoal.title}` : "General alignment");
  if (domain === "purchase") pushC("Practical benefit", 0.2, undefined, "What it actually does for you week to week");
  pushC("Downside risk", 0.15, undefined, "How bad is the worst case?");
  const sum = criteria.reduce((a, c) => a + c.weight, 0);
  criteria.forEach((c) => (c.weight = Number((c.weight / sum).toFixed(3))));

  // Heuristic first-pass scores — every one is an ESTIMATE with a rationale the user can edit.
  const scores: DecisionDraft["scores"] = [];
  options.forEach((o, i) => {
    criteria.forEach((c, j) => {
      let score = 5;
      let rationale = "Neutral starting estimate — adjust";
      const isYes = i === 0;
      const isWait = /wait|decline|keep current/i.test(o.label);
      if (c.name === "Cost & runway") {
        const cost = o.upfrontCost ?? 0;
        score = cost <= 0 ? 10 : clamp(10 - (cost / Math.max(1, fin.liquid)) * 25, 0, 10);
        rationale = cost ? `${money(cost)} is ${pct(cost / Math.max(1, fin.liquid))} of liquid cash` : "No upfront cost";
      } else if (c.name === "Time & focus cost") {
        score = isWait ? 9 : isYes ? 4 : 6;
        rationale = isWait ? "Frees time now" : isYes ? "Adds a new time commitment" : "Smaller commitment";
      } else if (c.name === "Career impact") {
        score = domain === "project" ? 6 + (w.projects.find((p) => p.title === o.label)?.priority ?? 3) / 2 : isWait ? 4 : isYes ? 7 : 6;
        rationale = domain === "project" ? "Based on project priority" : isYes ? "Direct step towards career goal" : "Weaker or delayed career effect";
      } else if (c.name === "Effort to finish") {
        score = clamp(10 - (o.timeHours ?? 5) / 2, 1, 10);
        rationale = `${o.timeHours ?? "?"}h of estimated remaining work`;
      } else if (c.name === "Time to impact") {
        score = clamp(10 - (o.timeHours ?? 5) / 2.5, 1, 10);
        rationale = "Shorter remaining work ⇒ sooner impact";
      } else if (c.name === "Fit with current goals") {
        score = isWait ? 5 : clamp(4 + cosine(localEmbed(o.label), localEmbed(mostRelevantGoal?.title ?? "")) * 20, 3, 9);
        rationale = "Semantic similarity to your most related goal";
      } else if (c.name === "Downside risk") {
        score = isWait ? 8 : isYes ? 5 : 7;
        rationale = isWait ? "Little downside, but opportunity cost" : isYes ? "Full commitment carries the most downside" : "Limited downside";
      } else if (c.name === "Practical benefit") {
        score = isYes ? 8 : isWait ? 3 : 6;
        rationale = isYes ? "Full benefit" : "Partial or delayed benefit";
      }
      score = Number(score.toFixed(1));
      scores.push({ option: i, criterion: j, score, low: Math.max(0, Number((score - 2).toFixed(1))), high: Math.min(10, Number((score + 2).toFixed(1))), rationale });
    });
  });

  const constraints = w.memories
    .filter((m) => m.status === "active" && m.category === "constraint")
    .map((m) => ({ m, sim: cosine(qv, localEmbed(m.content)) }))
    .filter((x) => x.sim > 0.05)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 3)
    .map((x) => ({ text: x.m.content, hard: x.m.importance >= 5, provenance: x.m.source }));

  const unknownsByDomain: Record<string, DecisionModelExtras["unknowns"]> = {
    purchase: [
      { question: "What is the total cost of ownership over 12 months, not just the price?", impact: "high", wouldChange: "Running costs can exceed the purchase price." },
      { question: "How often will you actually use it per month?", impact: "high" },
      { question: "Is there a return or resale option?", impact: "medium" },
    ],
    learning: [
      { question: "Do your target employers value this credential or prefer portfolio evidence?", impact: "high", wouldChange: "Recruiter preference determines career impact." },
      { question: "Is there a discount, employer funding or free equivalent?", impact: "medium" },
      { question: "Can you complete it without displacing higher-priority work?", impact: "high" },
    ],
    career: [
      { question: "Does it offer visa sponsorship / long-term work rights?", impact: "high" },
      { question: "What does the role lead to in 2 years?", impact: "high" },
      { question: "What is the realistic alternative and its timeline?", impact: "medium" },
    ],
    project: [
      { question: "Which project would an interviewer ask about first?", impact: "high" },
      { question: "Are any projects blocked by something outside your control?", impact: "medium" },
    ],
    finance: [
      { question: "What are the one-off switching costs?", impact: "high", wouldChange: "Switching costs often cancel monthly savings (see your past lesson)." },
      { question: "How does it change your runway?", impact: "medium" },
    ],
    general: [{ question: "What would you need to believe for each option to be the best?", impact: "medium" }],
  };

  const stakes: DecisionDraft["stakes"] = amount && amount > fin.liquid * 0.3 ? "high" : domain === "career" ? "high" : amount && amount > 200 ? "medium" : "medium";
  return {
    title: question.length > 80 ? `${question.slice(0, 77)}…` : question.replace(/\?*$/, "?"),
    question,
    domain,
    stakes,
    reversibility: domain === "purchase" ? "partly" : domain === "career" ? "partly" : "reversible",
    options,
    criteria,
    scores,
    model: {
      objectives: criteria.filter((c) => c.goalId).map((c) => w.idx.goal.get(c.goalId!)!.title),
      constraints,
      facts: [
        { text: `Liquid cash ${money(fin.liquid)}, runway ≈ ${fin.runwayMonths.toFixed(1)} months`, provenance: "estimate" },
        ...(amount ? [{ text: `Amount in question: ${money(amount)} (${pct(amount / Math.max(1, fin.liquid))} of liquid cash)`, provenance: "user_input" }] : []),
      ],
      unknowns: unknownsByDomain[domain] ?? unknownsByDomain.general,
      risks: [],
      assumptions: [{ text: "Initial scores are heuristic estimates generated by LIFEOS — review and adjust them", provenance: "assumption" }],
      secondOrder: [],
    },
  };
}
