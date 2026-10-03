/**
 * Opportunity Radar (objective → ranked routes) and the LIFEOS Radar map (the user's world as a
 * radial graph with inferred "potential opportunities").
 *
 * Estimates are always labelled. Success probabilities are explicit ASSUMPTIONS derived from fit,
 * never presented as predictions.
 */
import { clamp, daysSince, daysUntil, money, relativeDay } from "@/lib/format";
import type { Evidence, OpportunityRoute } from "@/lib/types";
import { confidenceFromScore } from "@/lib/types";
import { cosine, localEmbed } from "@/server/ai/embeddings";
import { annualValue, financeSummary, goalLastActivity, isOpenOpp, opportunityFit, projectProgress, relationshipHeat, skillEvidence } from "./signals";
import { linksOf, type World } from "./world";

export type Theme = "income" | "career" | "learning" | "network" | "general";

const THEME_WORDS: Record<Exclude<Theme, "general">, RegExp> = {
  income: /\b(income|money|earn|salary|pay|revenue|cash|rich|wealth|side hustle|freelance|£)\b/i,
  career: /\b(job|career|role|hired|offer|promotion|employ|graduate|analyst|visa|sponsor)\b/i,
  learning: /\b(learn|skill|course|study|certif|qualif|upskill|exam)\b/i,
  network: /\b(network|people|connect|mentor|relationship|intro|contacts?)\b/i,
};

export function detectTheme(objective: string): Theme {
  for (const [theme, re] of Object.entries(THEME_WORDS)) if (re.test(objective)) return theme as Theme;
  return "general";
}

const TYPE_AFFINITY: Record<Theme, Record<string, number>> = {
  income: { job: 0.9, freelance: 1, side_income: 1, internship: 0.6, course: 0.2, event: 0.3, networking: 0.3, scholarship: 0.5, grant: 0.6, investment: 0.5 },
  career: { job: 1, internship: 0.8, networking: 0.8, event: 0.7, course: 0.6, freelance: 0.5, side_income: 0.2, scholarship: 0.4, grant: 0.2, investment: 0.1 },
  learning: { course: 1, event: 0.7, networking: 0.5, job: 0.3, freelance: 0.4, side_income: 0.3, internship: 0.5, scholarship: 0.6, grant: 0.3, investment: 0.1 },
  network: { networking: 1, event: 0.9, job: 0.5, course: 0.3, freelance: 0.4, side_income: 0.2, internship: 0.5, scholarship: 0.3, grant: 0.2, investment: 0.1 },
  general: { job: 0.8, freelance: 0.7, side_income: 0.6, course: 0.6, event: 0.6, networking: 0.6, internship: 0.6, scholarship: 0.5, grant: 0.5, investment: 0.5 },
};

/** Explicit, simple success-probability assumption from fit (shown to the user as an ASSUMPTION). */
export function assumedSuccess(fit: number, type: string, status: string): number {
  const base = type === "job" ? 0.12 : type === "freelance" ? 0.45 : type === "side_income" ? 0.35 : 0.7;
  const stage = status === "interviewing" ? 2.5 : status === "applied" ? 1.2 : status === "won" ? 8 : 1;
  return clamp(base * stage * (0.5 + fit), 0.02, 0.95);
}

function periodLabel(p: string | null) {
  return p === "per_year" ? "/yr" : p === "per_month" ? "/mo" : p === "per_day" ? "/day" : "";
}

export function opportunityRadar(w: World, objective: string): { theme: Theme; routes: OpportunityRoute[]; objectiveVector: number } {
  const theme = detectTheme(objective);
  const qv = localEmbed(objective);
  const routes: OpportunityRoute[] = [];

  for (const o of w.opportunities.filter((o) => isOpenOpp(o) || o.status === "won")) {
    const fit = opportunityFit(w, o.id);
    const company = o.companyId ? w.idx.company.get(o.companyId)?.name : undefined;
    const sim = cosine(qv, localEmbed(`${o.title} ${o.type} ${o.description ?? ""} ${company ?? ""}`));
    const relevance = (TYPE_AFFINITY[theme][o.type] ?? 0.4) * 0.75 + clamp(sim * 2) * 0.25;
    if (relevance < 0.3) continue;
    const p = assumedSuccess(fit.score, o.type, o.status);
    const annual = annualValue(o);
    const deps: string[] = [
      ...fit.gaps.map((g) => `${g.name} ${g.have}→${g.need}${g.essential ? "" : " (nice to have)"}`),
      ...(fit.visaRisk.blocked ? ["Visa sponsorship not offered"] : []),
    ];
    const blockedProject = linksOf(w, "opportunity", o.id).map((l) => (l.fromType === "project" ? l.fromId : l.toType === "project" ? l.toId : null)).filter(Boolean).map((id) => w.idx.project.get(id!)).find((p) => p?.status === "blocked");
    if (blockedProject) deps.push(`Unblock “${blockedProject.title}”`);
    const why: Evidence[] = [
      ...fit.matched.slice(0, 3).map((m) => ({ text: `${m.name} ${m.have}/5 meets ${m.need}${m.evidencedBy.length ? ` (evidence: ${m.evidencedBy[0]})` : ""}`, provenance: "fact" as const })),
      ...fit.contacts.map((c) => ({ text: `Warm path via ${c.name} (${c.relation.replace("_", " ")})`, provenance: "fact" as const, ref: { type: "person" as const, id: c.personId, label: c.name } })),
      ...(o.source === "ai_inference" ? [{ text: o.description ?? "Inferred from your data", provenance: "ai_inference" as const }] : []),
    ];
    const nextAction = nextActionFor(w, o.id);
    const ev = annual !== null ? annual * p : null;
    routes.push({
      id: o.id,
      title: o.title,
      kind: "existing",
      ref: { type: "opportunity", id: o.id, label: o.title },
      upside:
        o.valueLow !== null || o.valueHigh !== null
          ? {
              low: o.valueLow ?? o.valueHigh ?? 0,
              high: o.valueHigh ?? o.valueLow ?? 0,
              period: periodLabel(o.valuePeriod),
              provenance: o.source === "document" || o.source === "integration" ? "fact" : o.source === "ai_inference" ? "estimate" : "user_input",
              note: o.source === "document" ? "Stated in the job description" : o.source === "ai_inference" ? "Inferred range — verify" : "As recorded",
            }
          : null,
      timeHours: o.effortHours !== null ? { value: o.effortHours, provenance: "estimate" } : null,
      cost: o.cost !== null ? { value: o.cost, provenance: "user_input" } : null,
      difficulty: o.difficulty,
      confidence: confidenceFromScore(fit.score),
      confidenceScore: Number(fit.score.toFixed(2)),
      fitScore: Number((relevance * (0.4 + fit.score * 0.6)).toFixed(3)),
      deadline: o.deadline,
      dependencies: deps,
      skillsMatched: fit.matched.map((m) => m.name),
      skillsMissing: fit.gaps.map((g) => g.name),
      whyItFits: why.length ? why : [{ text: `Matches the “${theme}” objective by type (${o.type})`, provenance: "ai_inference" }],
      assumptions: [`Success probability assumed ≈ ${Math.round(p * 100)}% (base rate for ${o.type} × stage × fit) — not a prediction`, ...(annual !== null && o.valuePeriod === "per_day" ? ["Day-rate converted using stated effort over ~13 weeks"] : [])],
      nextAction,
      expectedValueNote: ev !== null ? `≈ ${money(ev)}${o.valuePeriod === "one_off" ? "" : "/yr"} risk-adjusted (midpoint ${money(annual)} × ${Math.round(p * 100)}% assumed)` : "No value recorded",
    });
  }

  const existing = routes.sort((a, b) => routeRank(b) - routeRank(a)).slice(0, 7);
  const inferred = inferredRoutes(w, theme).sort((a, b) => routeRank(b) - routeRank(a)).slice(0, 3);
  return { theme, routes: [...existing, ...inferred], objectiveVector: qv.length };
}

function routeRank(r: OpportunityRoute) {
  const deadlineBoost = r.deadline ? (daysUntil(r.deadline) ?? 99) <= 7 ? 0.1 : 0 : 0;
  return r.fitScore + deadlineBoost + (r.kind === "inferred" ? 0.05 : 0);
}

export function nextActionFor(w: World, oppId: string): string {
  const o = w.idx.opportunity.get(oppId)!;
  const fit = opportunityFit(w, oppId);
  const unanswered = w.messages.find((m) => m.opportunityId === oppId && m.direction === "in" && m.needsReply);
  if (unanswered && o.status === "interviewing") {
    const p = unanswered.personId ? w.idx.person.get(unanswered.personId) : undefined;
    const ev = w.events.find((e) => e.opportunityId === oppId && e.startsAt > w.now);
    return `Confirm attendance with ${p?.name ?? "the recruiter"} today, then finish prep${ev ? ` for ${ev.title} (${relativeDay(ev.startsAt, w.now)})` : ""}.`;
  }
  if (unanswered) {
    const p = unanswered.personId ? w.idx.person.get(unanswered.personId) : undefined;
    return `Reply to ${p?.name ?? "the contact"} today and propose a 15-minute call${o.deadline ? ` before the ${relativeDay(o.deadline, w.now)} deadline` : ""}.`;
  }
  if (o.status === "interviewing") {
    const ev = w.events.find((e) => e.opportunityId === oppId && e.startsAt > w.now);
    return ev ? `Finish interview prep for ${ev.title} (${relativeDay(ev.startsAt, w.now)}).` : "Send a thank-you note and ask about next steps.";
  }
  if (o.status === "applied") {
    const referrer = fit.contacts.find((c) => c.relation === "can_refer");
    if (referrer) return `Message ${referrer.name} with the job link and ask for the referral they offered.`;
    const app = w.applications.find((a) => a.opportunityId === oppId);
    return `Send a short follow-up (applied ${relativeDay(app?.submittedAt, w.now)}).`;
  }
  const evidence = fit.matched.find((m) => m.evidencedBy.length);
  if (o.type === "job")
    return `Tailor your CV to lead with ${evidence ? `“${evidence.evidencedBy[0]}” as evidence of ${evidence.name}` : fit.matched[0]?.name ?? "your strongest matching skill"}${fit.gaps[0] ? ` and address the ${fit.gaps[0].name} gap in the cover letter` : ""}, then submit.`;
  if ((o.effortHours ?? 1) <= 0.5) return `Complete the ${Math.round((o.effortHours ?? 0.3) * 60)}-minute ${o.type === "event" ? "RSVP" : "application"} now.`;
  if (o.type === "freelance" && o.contactPersonId) return `Send ${w.idx.person.get(o.contactPersonId)?.name} a one-paragraph proposal with scope, price and start date.`;
  return `Spend 30 minutes scoping “${o.title}”: define the first deliverable and what you'd charge.`;
}

function inferredRoutes(w: World, theme: Theme): OpportunityRoute[] {
  const out: OpportunityRoute[] = [];
  const fin = financeSummary(w);
  const minRate = w.memories.find((m) => /minimum effective freelance rate/i.test(m.content));
  const rateMatch = minRate?.content.match(/£\s?(\d+)/);

  if (theme === "income" || theme === "general") {
    // Strong, evidenced skills not yet monetised
    const monetised = new Set(w.opportunitySkills.filter((r) => ["freelance", "side_income"].includes(w.idx.opportunity.get(r.opportunityId)?.type ?? "")).map((r) => r.skillId));
    const candidates = w.skills.filter((k) => k.level >= 3 && skillEvidence(w, k.id).length && !monetised.has(k.id));
    for (const k of candidates.slice(0, 1)) {
      const rate = rateMatch ? Number(rateMatch[1]) : 30;
      out.push({
        id: `inferred:skill:${k.id}`,
        title: `Offer ${k.name} work to existing contacts`,
        kind: "inferred",
        upside: { low: rate * 8, high: rate * 20, period: "/mo", provenance: "estimate", note: `${8}–${20} hours/month at your £${rate}/h floor` },
        timeHours: { value: 3, provenance: "estimate" },
        cost: { value: 0, provenance: "assumption" },
        difficulty: 2,
        confidence: "low",
        confidenceScore: 0.35,
        fitScore: 0.45,
        deadline: null,
        dependencies: ["A short portfolio sample", "1–2 warm leads"],
        skillsMatched: [k.name],
        skillsMissing: [],
        whyItFits: [
          { text: `${k.name} at ${k.level}/5 with project evidence: ${skillEvidence(w, k.id).map((p) => p.title).join(", ")}`, provenance: "fact" },
          { text: `No current freelance opportunity uses ${k.name}`, provenance: "ai_inference" },
        ],
        assumptions: ["Demand exists among your network for this skill", "Hours available alongside job search"],
        nextAction: `List three people who could need ${k.name} help and message one today.`,
        expectedValueNote: "Speculative — validate with one conversation before investing time",
      });
    }
    // Recurring subscriptions misaligned with goals → net income
    const gym = fin.recurring.find((r) => r.category === "Fitness");
    const health = w.goals.find((g) => g.category === "health" && g.status === "active");
    if (gym && health && (daysSince(goalLastActivity(w, health.id), w.now) ?? 0) >= 14)
      out.push({
        id: "inferred:cut:fitness",
        title: `Pause ${gym.description} until training restarts`,
        kind: "inferred",
        upside: { low: gym.monthly, high: gym.monthly, period: "/mo", provenance: "fact", note: "Recurring charge observed in transactions" },
        timeHours: { value: 0.2, provenance: "estimate" },
        cost: { value: 0, provenance: "assumption" },
        difficulty: 1,
        confidence: "medium",
        confidenceScore: 0.6,
        fitScore: 0.32,
        deadline: null,
        dependencies: [],
        skillsMatched: [],
        skillsMissing: [],
        whyItFits: [{ text: `No ${health.title.toLowerCase()} activity for ${daysSince(goalLastActivity(w, health.id), w.now)} days`, provenance: "fact" }],
        assumptions: ["Membership can be frozen without a fee"],
        nextAction: "Check the freeze policy in the gym app (2 minutes).",
        expectedValueNote: `+${money(gym.monthly * 12)}/yr net, certain if done`,
      });
  }

  if (theme === "career" || theme === "learning" || theme === "income" || theme === "general") {
    // Skill gap that unlocks several roles
    const gapMap = new Map<string, string[]>();
    for (const r of w.opportunitySkills.filter((r) => r.essential)) {
      const o = w.idx.opportunity.get(r.opportunityId);
      const k = w.idx.skill.get(r.skillId);
      if (!o || !k || !isOpenOpp(o) || k.level >= r.requiredLevel) continue;
      gapMap.set(k.id, [...(gapMap.get(k.id) ?? []), o.title]);
    }
    const top = [...gapMap.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (top && top[1].length >= 2) {
      const k = w.idx.skill.get(top[0])!;
      const course = w.courses.find((c) => c.skillId === k.id);
      out.push({
        id: `inferred:gap:${k.id}`,
        title: `Close the ${k.name} gap to unlock ${top[1].length} roles`,
        kind: "inferred",
        upside: null,
        timeHours: { value: course?.hoursTotal ? course.hoursTotal - course.hoursDone : 20, provenance: "estimate" },
        cost: { value: course?.cost ?? 0, provenance: course ? "fact" : "assumption" },
        difficulty: 3,
        confidence: "medium",
        confidenceScore: 0.55,
        fitScore: 0.5,
        deadline: null,
        dependencies: course ? [`Finish “${course.title}” (${course.hoursDone}/${course.hoursTotal}h)`] : ["Pick a course or project"],
        skillsMatched: [],
        skillsMissing: [k.name],
        whyItFits: top[1].map((t) => ({ text: `${t} requires ${k.name}`, provenance: "fact" as const })),
        assumptions: ["A finished project is accepted as evidence of the level"],
        nextAction: course ? `Do one 45-minute module of “${course.title}” tonight.` : `Pick one ${k.name} project and schedule the first session.`,
        expectedValueNote: "Raises fit on several applications at once (indirect value)",
      });
    }
  }

  if (theme === "network" || theme === "career" || theme === "general") {
    for (const p of w.people.filter((p) => p.strength >= 4)) {
      const heat = relationshipHeat(p, w.now);
      if (!heat.cooling) continue;
      out.push({
        id: `inferred:reconnect:${p.id}`,
        title: `Reconnect with ${p.name}`,
        kind: "inferred",
        upside: null,
        timeHours: { value: 0.2, provenance: "estimate" },
        cost: null,
        difficulty: 1,
        confidence: "medium",
        confidenceScore: 0.5,
        fitScore: 0.42,
        deadline: null,
        dependencies: [],
        skillsMatched: [],
        skillsMissing: [],
        whyItFits: [{ text: `Strong tie (${p.strength}/5), ${heat.daysSince} days since contact${p.notes ? ` — ${p.notes}` : ""}`, provenance: "fact" }],
        assumptions: ["They're still open to helping"],
        nextAction: `Send ${p.name.split(" ")[0]} a short, specific message today.`,
        expectedValueNote: "Relationship value — not quantified",
      });
    }
  }
  return out;
}

/* ───────────────────────────── LIFEOS Radar map ───────────────────────────── */

export type RadarSector = "goal" | "project" | "opportunity" | "person" | "skill" | "document" | "decision";

export interface RadarNode {
  id: string;
  type: RadarSector | "user" | "potential";
  label: string;
  sublabel?: string;
  weight: number; // 0..1 → size
  status: "healthy" | "attention" | "risk" | "neutral";
  href?: string;
}

export interface RadarEdge {
  from: string;
  to: string;
  relation: string;
  provenance: string;
  inferred?: boolean;
}

export interface PotentialOpportunity {
  id: string;
  title: string;
  why: string;
  supports: Evidence[];
  missing: string[];
  unlock: string[];
  nextAction: string;
  confidence: number;
  value: string | null;
  related: string[]; // node ids
  category: "evidence" | "referral" | "recurring_revenue" | "skill_unlock" | "warm_intro" | "synergy" | "risk";
}

const nodeId = (type: string, id: string) => `${type}:${id}`;

export function buildRadarMap(w: World): { nodes: RadarNode[]; edges: RadarEdge[]; potentials: PotentialOpportunity[] } {
  const nodes: RadarNode[] = [{ id: "user", type: "user", label: w.user.name, sublabel: w.user.headline ?? undefined, weight: 1, status: "neutral" }];
  const edges: RadarEdge[] = [];
  const has = new Set<string>(["user"]);
  const add = (n: RadarNode) => {
    if (!has.has(n.id)) {
      has.add(n.id);
      nodes.push(n);
    }
  };

  for (const g of w.goals.filter((g) => g.status === "active")) {
    const quiet = (daysSince(goalLastActivity(w, g.id), w.now) ?? 99) >= w.settings.neglectDays;
    add({ id: nodeId("goal", g.id), type: "goal", label: g.title, sublabel: `P${g.priority}`, weight: g.priority / 5, status: quiet ? "attention" : "healthy", href: `/goals/${g.id}` });
    edges.push({ from: "user", to: nodeId("goal", g.id), relation: "pursues", provenance: "user_input" });
  }
  for (const p of w.projects.filter((p) => p.status !== "done")) {
    const prog = projectProgress(w, p.id);
    add({ id: nodeId("project", p.id), type: "project", label: p.title, sublabel: `${Math.round(prog.pct * 100)}%`, weight: 0.3 + p.priority / 10, status: p.status === "blocked" ? "risk" : p.status === "paused" ? "attention" : "healthy", href: `/projects/${p.id}` });
    if (p.goalId) edges.push({ from: nodeId("project", p.id), to: nodeId("goal", p.goalId), relation: "advances", provenance: "user_input" });
  }
  for (const o of w.opportunities.filter(isOpenOpp)) {
    const fit = opportunityFit(w, o.id);
    const d = daysUntil(o.deadline, w.now);
    add({ id: nodeId("opportunity", o.id), type: "opportunity", label: o.title.split("—")[0].trim(), sublabel: o.title.split("—")[1]?.trim() ?? o.type, weight: 0.3 + fit.score * 0.7, status: fit.visaRisk.blocked ? "risk" : d !== null && d <= 3 ? "attention" : "healthy", href: `/opportunities/${o.id}` });
    if (o.contactPersonId) edges.push({ from: nodeId("person", o.contactPersonId), to: nodeId("opportunity", o.id), relation: "contact", provenance: "user_input" });
  }
  const relevantPeople = w.people.filter((p) => p.strength >= 3 || w.opportunities.some((o) => o.contactPersonId === p.id && isOpenOpp(o)));
  for (const p of relevantPeople) {
    const heat = relationshipHeat(p, w.now);
    add({ id: nodeId("person", p.id), type: "person", label: p.name, sublabel: p.role ?? p.relationship, weight: p.strength / 5, status: heat.cooling ? "attention" : "healthy", href: `/people/${p.id}` });
  }
  for (const k of w.skills) {
    const gapIn = w.opportunitySkills.filter((r) => r.skillId === k.id && r.essential && k.level < r.requiredLevel && isOpenOpp(w.idx.opportunity.get(r.opportunityId)!)).length;
    add({ id: nodeId("skill", k.id), type: "skill", label: k.name, sublabel: `${k.level}/5`, weight: k.level / 5, status: gapIn >= 2 ? "attention" : "healthy" });
  }
  for (const d of w.documents.filter((d) => d.status === "processed").slice(0, 12)) add({ id: nodeId("document", d.id), type: "document", label: d.title.split("—")[0].trim(), sublabel: d.kind.replace("_", " "), weight: 0.35, status: "neutral", href: `/documents/${d.id}` });
  for (const d of w.decisions.filter((d) => d.status !== "decided")) add({ id: nodeId("decision", d.id), type: "decision", label: d.title, sublabel: d.stakes, weight: d.stakes === "high" ? 0.8 : 0.5, status: d.deadline && (daysUntil(d.deadline, w.now) ?? 99) <= 5 ? "attention" : "neutral", href: `/decisions/${d.id}` });

  for (const r of w.opportunitySkills) {
    if (has.has(nodeId("opportunity", r.opportunityId)) && r.essential) edges.push({ from: nodeId("skill", r.skillId), to: nodeId("opportunity", r.opportunityId), relation: "required by", provenance: "fact" });
  }
  for (const l of w.links) {
    const a = nodeId(l.fromType, l.fromId);
    const b = nodeId(l.toType, l.toId);
    if (has.has(a) && has.has(b) && !edges.some((e) => e.from === a && e.to === b)) edges.push({ from: a, to: b, relation: l.relation.replace("_", " "), provenance: l.provenance });
  }
  for (const d of w.decisions.filter((d) => d.status !== "decided")) {
    for (const c of w.decisionCriteria.filter((c) => c.decisionId === d.id && c.linkedGoalId)) {
      if (has.has(nodeId("goal", c.linkedGoalId!))) edges.push({ from: nodeId("decision", d.id), to: nodeId("goal", c.linkedGoalId!), relation: "affects", provenance: "user_input" });
    }
  }

  const potentials = inferPotentials(w);
  for (const p of potentials) {
    add({ id: p.id, type: "potential", label: p.title, weight: 0.4 + p.confidence * 0.6, status: p.category === "risk" ? "risk" : "attention" });
    for (const r of p.related) if (has.has(r)) edges.push({ from: p.id, to: r, relation: "inferred", provenance: "ai_inference", inferred: true });
  }
  return { nodes, edges, potentials };
}

/** Pattern-based inference of opportunities hidden in the graph. Each pattern cites its evidence. */
export function inferPotentials(w: World): PotentialOpportunity[] {
  const out: PotentialOpportunity[] = [];

  // 1. Evidence → opportunity: a project proves skills an application needs, but isn't linked
  for (const p of w.projects.filter((p) => p.status !== "done" && p.status !== "paused")) {
    const skills = linksOf(w, "project", p.id).filter((l) => l.relation === "evidences").map((l) => l.toId);
    for (const o of w.opportunities.filter((o) => isOpenOpp(o) && o.type === "job")) {
      if (linksOf(w, "opportunity", o.id).some((l) => l.fromId === p.id || l.toId === p.id)) continue;
      if (opportunityFit(w, o.id).visaRisk.blocked) continue; // not worth strengthening a route that can't work
      const shared = w.opportunitySkills.filter((r) => r.opportunityId === o.id && skills.includes(r.skillId)).map((r) => w.idx.skill.get(r.skillId)!);
      const domain = shared.filter((k) => k.category !== "tool");
      if (domain.length < 2) continue;
      const prog = projectProgress(w, p.id);
      const fit = opportunityFit(w, o.id);
      out.push({
        id: `potential:evidence:${p.id}:${o.id}`,
        title: `Use “${p.title}” as evidence for ${o.title.split("—")[1]?.trim() ?? o.title}`,
        why: `${p.title} demonstrates ${domain.map((k) => k.name).join(" and ")}, which ${o.title} explicitly requires — but the project isn't referenced in that application.`,
        supports: [
          { text: `${p.title} evidences ${shared.map((k) => k.name).join(", ")}`, provenance: "fact", ref: { type: "project", id: p.id, label: p.title } },
          { text: `${o.title} requires ${domain.map((k) => `${k.name} ≥ ${w.opportunitySkills.find((r) => r.opportunityId === o.id && r.skillId === k.id)?.requiredLevel}`).join(", ")}`, provenance: "fact", ref: { type: "opportunity", id: o.id, label: o.title } },
          { text: `Current fit ${Math.round(fit.score * 100)}%`, provenance: "estimate" },
          ...(o.deadline ? [{ text: `Deadline ${relativeDay(o.deadline, w.now)}`, provenance: "fact" as const }] : []),
        ],
        missing: [
          ...(prog.pct < 0.8 ? [`Project only ${Math.round(prog.pct * 100)}% complete — needs a presentable artefact`] : []),
          ...(p.status === "blocked" ? [`Project blocked: ${prog.blocked[0]?.blockedReason ?? prog.blocked[0]?.title ?? "dependency"}`] : []),
          "No public write-up linked from your CV",
        ],
        unlock: [
          ...(prog.blocked.length ? prog.blocked.slice(0, 1).map((t) => `Resolve “${t.dependsOnTaskId ? w.idx.task.get(t.dependsOnTaskId)?.title : t.title}”`) : []),
          "Add one CV bullet with a quantified result from the project",
        ],
        nextAction: p.status === "blocked" && prog.blocked[0]?.dependsOnTaskId ? `Do “${w.idx.task.get(prog.blocked[0].dependsOnTaskId)?.title}” (${w.idx.task.get(prog.blocked[0].dependsOnTaskId)?.estimateMinutes ?? 20} min), then add the project to your ${o.title.split("—")[1]?.trim() ?? ""} application.` : `Add a project bullet and link to the ${o.title.split("—")[1]?.trim() ?? ""} application.`,
        confidence: 0.55 + Math.min(0.3, domain.length * 0.1),
        value: annualValue(o) ? `${money(o.valueLow)}–${money(o.valueHigh)}/yr role` : null,
        related: [nodeId("project", p.id), nodeId("opportunity", o.id), ...domain.map((k) => nodeId("skill", k.id))],
        category: "evidence",
      });
    }
  }

  // 2. Referral paths: someone offered to refer, the application is live, no follow-up yet
  for (const l of w.links.filter((l) => l.relation === "can_refer" && l.toType === "opportunity")) {
    const person = w.idx.person.get(l.fromId);
    const o = w.idx.opportunity.get(l.toId);
    if (!person || !o || !isOpenOpp(o)) continue;
    const heat = relationshipHeat(person, w.now);
    const pendingIntro = w.links.find((x) => x.relation === "wants_intro" && x.toId === person.id);
    const introducer = pendingIntro ? w.idx.person.get(pendingIntro.fromId) : undefined;
    out.push({
      id: `potential:referral:${person.id}:${o.id}`,
      title: `Referral from ${person.name} into ${w.idx.company.get(o.companyId ?? "")?.name ?? o.title}`,
      why: `${person.name} offered to refer you, and your application to ${o.title} is live without a referral.`,
      supports: [
        { text: l.rationale ?? "Offered referral", provenance: "fact", ref: { type: "person", id: person.id, label: person.name } },
        { text: `Application status: ${o.status}`, provenance: "fact", ref: { type: "opportunity", id: o.id, label: o.title } },
        { text: `Referred candidates typically convert several times better than cold applicants`, provenance: "assumption" },
      ],
      missing: [heat.cooling ? `You haven't spoken in ${heat.daysSince} days — re-warm first` : "Nothing major", ...(introducer ? [`You owe ${introducer.name} an intro to ${person.name}`] : [])],
      unlock: introducer ? [`Make the intro ${introducer.name} asked for — it gives you a natural reason to reconnect`] : ["A short, specific ask with the job link"],
      nextAction: introducer
        ? `Message ${person.name.split(" ")[0]}: introduce ${introducer.name.split(" ")[0]} (as promised) and ask about the ${o.title.split("—")[0].trim()} referral in the same note.`
        : `Message ${person.name.split(" ")[0]} with the job link and ask for the referral.`,
      confidence: 0.7,
      value: annualValue(o) ? `${money(o.valueLow)}–${money(o.valueHigh)}/yr role` : null,
      related: [nodeId("person", person.id), nodeId("opportunity", o.id), ...(introducer ? [nodeId("person", introducer.id)] : [])],
      category: "referral",
    });
  }

  // 3. Recurring revenue: a satisfied client hinted at ongoing work
  for (const o of w.opportunities.filter((o) => o.type === "freelance" && o.valuePeriod === "per_month" && isOpenOpp(o))) {
    const person = o.contactPersonId ? w.idx.person.get(o.contactPersonId) : undefined;
    const msg = w.messages.find((m) => m.personId === o.contactPersonId && m.direction === "in" && m.needsReply);
    const goal = w.goals.find((g) => g.category === "finance" && /freelance/i.test(g.title));
    const gapToGoal = goal && goal.targetValue && goal.currentValue !== null ? goal.targetValue - goal.currentValue : null;
    out.push({
      id: `potential:recurring:${o.id}`,
      title: `Turn ${person?.name ?? "a client"} into recurring revenue`,
      why: `${msg ? `${person?.name} asked about ongoing work` : "A client relationship"} — a ${money(o.valueLow)}–${money(o.valueHigh)}/month retainer${gapToGoal ? ` would close ${Math.round(((o.valueLow ?? 0) / gapToGoal) * 100)}–${Math.round(((o.valueHigh ?? 0) / gapToGoal) * 100)}% of the gap to your freelance income goal` : ""}.`,
      supports: [
        ...(msg ? [{ text: `“${msg.body?.slice(0, 120)}”`, provenance: "fact" as const, ref: { type: "message" as const, id: msg.id, label: msg.subject ?? "message" } }] : []),
        ...(goal ? [{ text: `Goal: ${goal.title} — currently £${goal.currentValue}/month`, provenance: "user_input" as const, ref: { type: "goal" as const, id: goal.id, label: goal.title } }] : []),
        { text: `Est. ${o.effortHours}h/month ⇒ ≈ ${money(((o.valueLow ?? 0) + (o.valueHigh ?? 0)) / 2 / (o.effortHours ?? 4))}/h effective`, provenance: "estimate" },
      ],
      missing: ["A written proposal with scope and price", "Agreement on data access (bank feeds)"],
      unlock: ["Automating bookkeeping with bank feeds (idea already in your notes) would cut hours"],
      nextAction: `Reply to ${person?.name.split(" ")[0] ?? "the client"} with a one-paragraph proposal: monthly management accounts, delivered by the 10th, ${money(o.valueHigh)}/month.`,
      confidence: msg ? 0.72 : 0.5,
      value: `${money(o.valueLow)}–${money(o.valueHigh)}/mo`,
      related: [nodeId("opportunity", o.id), ...(person ? [nodeId("person", person.id)] : []), ...(goal ? [nodeId("goal", goal.id)] : [])],
      category: "recurring_revenue",
    });
  }

  // 4. Synergy: an opportunity that reuses work on a blocked/active project
  for (const l of w.links.filter((l) => l.fromType === "opportunity" && l.toType === "project")) {
    const o = w.idx.opportunity.get(l.fromId);
    const p = w.idx.project.get(l.toId);
    if (!o || !p || !isOpenOpp(o)) continue;
    const prog = projectProgress(w, p.id);
    out.push({
      id: `potential:synergy:${o.id}:${p.id}`,
      title: `“${o.title}” doubles as progress on ${p.title}`,
      why: `Both use the same data and skills; one block of work can count twice — a public result for the portfolio and progress on the project.`,
      supports: [
        { text: l.rationale ?? "Related", provenance: l.provenance === "ai_inference" ? "ai_inference" : "fact" },
        { text: `${p.title}: ${Math.round(prog.pct * 100)}% complete, status ${p.status}`, provenance: "fact", ref: { type: "project", id: p.id, label: p.title } },
        ...(o.deadline ? [{ text: `Deadline ${relativeDay(o.deadline, w.now)}`, provenance: "fact" as const, ref: { type: "opportunity" as const, id: o.id, label: o.title } }] : []),
      ],
      missing: prog.blocked.length ? [`Project blocked: ${prog.blocked[0].blockedReason ?? prog.blocked[0].title}`] : [],
      unlock: prog.blocked.length && prog.blocked[0].dependsOnTaskId ? [`“${w.idx.task.get(prog.blocked[0].dependsOnTaskId)?.title}”`] : [],
      nextAction: prog.blocked.length && prog.blocked[0].dependsOnTaskId ? `Do “${w.idx.task.get(prog.blocked[0].dependsOnTaskId)?.title}” today — it unblocks both.` : `Register for ${o.title} and plan the first session.`,
      confidence: 0.6,
      value: null,
      related: [nodeId("opportunity", o.id), nodeId("project", p.id)],
      category: "synergy",
    });
  }

  // 5. Skill unlock: one gap shared by several roles
  const gaps = new Map<string, string[]>();
  for (const r of w.opportunitySkills.filter((r) => r.essential)) {
    const o = w.idx.opportunity.get(r.opportunityId);
    const k = w.idx.skill.get(r.skillId);
    if (o && k && isOpenOpp(o) && k.level < r.requiredLevel) gaps.set(k.id, [...(gaps.get(k.id) ?? []), o.id]);
  }
  for (const [skillId, oppIds] of gaps) {
    if (oppIds.length < 2) continue;
    const k = w.idx.skill.get(skillId)!;
    const course = w.courses.find((c) => c.skillId === k.id && c.status !== "completed");
    const project = w.projects.find((p) => linksOf(w, "project", p.id).some((l) => l.toId === k.id && l.relation === "evidences") && p.status !== "done");
    out.push({
      id: `potential:skill:${k.id}`,
      title: `${k.name} is the key to ${oppIds.length} roles`,
      why: `${oppIds.map((id) => w.idx.opportunity.get(id)!.title.split("—")[1]?.trim() ?? w.idx.opportunity.get(id)!.title).join(" and ")} both screen for ${k.name} above your current level ${k.level}/5.`,
      supports: oppIds.map((id) => ({ text: `${w.idx.opportunity.get(id)!.title} needs ${k.name} ≥ ${w.opportunitySkills.find((r) => r.opportunityId === id && r.skillId === k.id)?.requiredLevel}`, provenance: "fact" as const, ref: { type: "opportunity" as const, id, label: w.idx.opportunity.get(id)!.title } })),
      missing: [`Evidence at level ${Math.max(...oppIds.map((id) => w.opportunitySkills.find((r) => r.opportunityId === id && r.skillId === k.id)?.requiredLevel ?? 3))}`, ...(course ? [`Course ${course.hoursDone}/${course.hoursTotal}h done`] : [])],
      unlock: [...(course ? [`Finish “${course.title}”`] : []), ...(project ? [`Ship “${project.title}” as proof`] : [])],
      nextAction: course ? `Schedule two 45-minute ${k.name} sessions this week (start with the next module of “${course.title}”).` : `Start a small ${k.name} project this week.`,
      confidence: 0.6,
      value: null,
      related: [nodeId("skill", k.id), ...oppIds.map((id) => nodeId("opportunity", id)), ...(project ? [nodeId("project", project.id)] : [])],
      category: "skill_unlock",
    });
  }

  // 6. Risk: monetisation idea conflicts with a contract clause
  const ipClause = w.documentFields.find((f) => f.key === "clause_ip");
  const templates = w.opportunities.find((o) => isOpenOpp(o) && /template/i.test(o.title));
  if (ipClause && templates) {
    const doc = w.idx.document.get(ipClause.documentId);
    out.push({
      id: `potential:risk:ip:${templates.id}`,
      title: `IP clause may block “${templates.title}”`,
      why: `Your ${doc?.title ?? "contract"} assigns work product (including templates) to the counterparty — selling derived templates could breach it.`,
      supports: [
        { text: `“${ipClause.value.slice(0, 160)}”`, provenance: "fact", ref: doc ? { type: "document", id: doc.id, label: doc.title } : undefined },
        { text: templates.description ?? templates.title, provenance: "user_input", ref: { type: "opportunity", id: templates.id, label: templates.title } },
      ],
      missing: ["Which templates were created under the contract vs independently"],
      unlock: ["Build templates from scratch, outside client work", "Ask the platform for a written carve-out"],
      nextAction: "Before building anything, list which existing models were made for platform clients and exclude them.",
      confidence: 0.65,
      value: null,
      related: [nodeId("opportunity", templates.id), ...(doc ? [nodeId("document", doc.id)] : [])],
      category: "risk",
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}
