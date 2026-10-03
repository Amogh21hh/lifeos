/**
 * Derived signals computed from the World. Every function here is pure and explainable:
 * it returns the numbers *and* the facts those numbers came from.
 */
import { clamp, daysSince, daysUntil } from "@/lib/format";
import type { World } from "./world";
import { linksOf } from "./world";

/* ───────────── projects & goals ───────────── */

export interface ProjectProgress {
  pct: number;
  doneCount: number;
  totalCount: number;
  remaining: World["tasks"];
  remainingMinutes: number;
  blocked: World["tasks"];
}

export function projectProgress(w: World, projectId: string): ProjectProgress {
  const tasks = (w.idx.tasksByProject.get(projectId) ?? []).filter((t) => t.status !== "cancelled");
  const weight = (t: World["tasks"][number]) => t.estimateMinutes ?? 60;
  const total = tasks.reduce((a, t) => a + weight(t), 0);
  const done = tasks.filter((t) => t.status === "done");
  const doneW = done.reduce((a, t) => a + weight(t), 0);
  const remaining = tasks.filter((t) => t.status !== "done");
  const project = w.idx.project.get(projectId);
  return {
    pct: project?.status === "done" ? 1 : total ? doneW / total : 0,
    doneCount: done.length,
    totalCount: tasks.length,
    remaining,
    remainingMinutes: remaining.reduce((a, t) => a + weight(t), 0),
    blocked: remaining.filter((t) => t.status === "blocked" || (t.dependsOnTaskId && w.idx.task.get(t.dependsOnTaskId)?.status !== "done")),
  };
}

export function goalDirection(goal: World["goals"][number]): "up" | "down" {
  return /\b(under|below|less than|reduce|cut)\b/i.test(`${goal.title} ${goal.targetMetric ?? ""}`) ? "down" : "up";
}

export function goalProgress(goal: World["goals"][number]): number | null {
  if (goal.targetValue === null || goal.currentValue === null || goal.targetValue === 0) return null;
  if (goal.status === "achieved") return 1;
  if (goalDirection(goal) === "down") return clamp(goal.currentValue <= goal.targetValue ? 1 : goal.targetValue / goal.currentValue);
  return clamp(goal.currentValue / goal.targetValue);
}

/** Most recent meaningful activity touching a goal (directly, via its projects or tasks). */
export function goalLastActivity(w: World, goalId: string): Date | null {
  const projectIds = new Set(w.projects.filter((p) => p.goalId === goalId).map((p) => p.id));
  let latest: Date | null = w.idx.goal.get(goalId)?.lastActivityAt ?? null;
  for (const a of w.activities) {
    if (a.action === "postponed") continue;
    const hit =
      a.goalId === goalId ||
      (a.entityType === "project" && a.entityId && projectIds.has(a.entityId)) ||
      (a.entityType === "task" && a.entityId && projectIds.has(w.idx.task.get(a.entityId)?.projectId ?? ""));
    if (hit && (!latest || a.occurredAt > latest)) latest = a.occurredAt;
  }
  return latest;
}

export function projectLastActivity(w: World, projectId: string): Date | null {
  let latest = w.idx.project.get(projectId)?.lastActivityAt ?? null;
  const taskIds = new Set((w.idx.tasksByProject.get(projectId) ?? []).map((t) => t.id));
  for (const a of w.activities) {
    if (a.action === "postponed") continue;
    if ((a.entityType === "project" && a.entityId === projectId) || (a.entityType === "task" && a.entityId && taskIds.has(a.entityId)))
      if (!latest || a.occurredAt > latest) latest = a.occurredAt;
  }
  return latest;
}

/* ───────────── time allocation ───────────── */

export interface Allocation {
  totalMinutes: number;
  byGoal: { goalId: string | null; title: string; priority: number; minutes: number; share: number }[];
  sessions: number;
}

export function timeAllocation(w: World, days: number): Allocation {
  const since = w.now.getTime() - days * 86_400_000;
  const map = new Map<string | null, number>();
  let total = 0;
  let sessions = 0;
  for (const a of w.activities) {
    if (!a.minutesSpent || a.occurredAt.getTime() < since) continue;
    let goalId = a.goalId;
    if (!goalId && a.entityType === "project" && a.entityId) goalId = w.idx.project.get(a.entityId)?.goalId ?? null;
    if (!goalId && a.entityType === "task" && a.entityId) goalId = w.idx.task.get(a.entityId)?.goalId ?? null;
    map.set(goalId, (map.get(goalId) ?? 0) + a.minutesSpent);
    total += a.minutesSpent;
    sessions++;
  }
  const byGoal = [...map.entries()]
    .map(([goalId, minutes]) => {
      const g = goalId ? w.idx.goal.get(goalId) : undefined;
      return { goalId, title: g?.title ?? "Admin & unassigned", priority: g?.priority ?? 0, minutes, share: total ? minutes / total : 0 };
    })
    .sort((a, b) => b.minutes - a.minutes);
  return { totalMinutes: total, byGoal, sessions };
}

/* ───────────── finance ───────────── */

export interface FinanceSummary {
  liquid: number;
  savings: number;
  creditDebt: number;
  investments: number;
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyEssentials: number;
  monthlyNet: number;
  runwayMonths: number;
  monthsObserved: number;
  byCategory: { category: string; monthly: number }[];
  recurring: { description: string; monthly: number; category: string; lastSeen: string }[];
  monthly: { month: string; income: number; expenses: number }[];
}

const ESSENTIAL = new Set(["Rent", "Utilities", "Groceries", "Transport", "Phone", "Council tax", "Insurance"]);

export function financeSummary(w: World, windowDays = 90): FinanceSummary {
  const since = w.now.getTime() - windowDays * 86_400_000;
  const tx = w.transactions.filter((t) => new Date(`${t.occurredOn}T00:00:00Z`).getTime() >= since);
  const months = windowDays / 30;
  const income = tx.filter((t) => t.kind === "income").reduce((a, t) => a + t.amount, 0);
  const expenses = tx.filter((t) => t.kind === "expense").reduce((a, t) => a - t.amount, 0);
  const essentials = tx.filter((t) => t.kind === "expense" && ESSENTIAL.has(t.category)).reduce((a, t) => a - t.amount, 0);
  const cat = new Map<string, number>();
  for (const t of tx) if (t.kind === "expense") cat.set(t.category, (cat.get(t.category) ?? 0) - t.amount);
  const recurringMap = new Map<string, { total: number; count: number; category: string; lastSeen: string }>();
  for (const t of tx.filter((t) => t.recurring && t.kind === "expense")) {
    const r = recurringMap.get(t.description) ?? { total: 0, count: 0, category: t.category, lastSeen: t.occurredOn };
    r.total += -t.amount;
    r.count++;
    if (t.occurredOn > r.lastSeen) r.lastSeen = t.occurredOn;
    recurringMap.set(t.description, r);
  }
  const monthlyMap = new Map<string, { income: number; expenses: number }>();
  for (const t of w.transactions) {
    const m = t.occurredOn.slice(0, 7);
    const row = monthlyMap.get(m) ?? { income: 0, expenses: 0 };
    if (t.kind === "income") row.income += t.amount;
    if (t.kind === "expense") row.expenses += -t.amount;
    monthlyMap.set(m, row);
  }
  const liquid = w.accounts.filter((a) => a.type === "current" || a.type === "savings").reduce((a, x) => a + x.balance, 0);
  const savings = w.accounts.filter((a) => a.type === "savings").reduce((a, x) => a + x.balance, 0);
  const creditDebt = -w.accounts.filter((a) => a.type === "credit").reduce((a, x) => a + x.balance, 0);
  const investments = w.assets.filter((a) => a.type === "investment").reduce((a, x) => a + x.value, 0) + w.accounts.filter((a) => a.type === "investment").reduce((a, x) => a + x.balance, 0);
  const otherAssets = w.assets.filter((a) => a.type !== "investment").reduce((a, x) => a + x.value, 0);
  const monthlyExpenses = expenses / months;
  const monthlyEssentials = essentials / months;
  const monthlyIncome = income / months;
  return {
    liquid,
    savings,
    creditDebt,
    investments,
    netWorth: liquid + investments + otherAssets - creditDebt,
    monthlyIncome,
    monthlyExpenses,
    monthlyEssentials,
    monthlyNet: monthlyIncome - monthlyExpenses,
    runwayMonths: monthlyEssentials > 0 ? liquid / monthlyEssentials : Infinity,
    monthsObserved: months,
    byCategory: [...cat.entries()].map(([category, total]) => ({ category, monthly: total / months })).sort((a, b) => b.monthly - a.monthly),
    recurring: [...recurringMap.entries()].map(([description, r]) => ({ description, monthly: r.total / Math.max(1, Math.round(months)), category: r.category, lastSeen: r.lastSeen })).sort((a, b) => b.monthly - a.monthly),
    monthly: [...monthlyMap.entries()].sort().map(([month, v]) => ({ month, ...v })).slice(-6),
  };
}

/* ───────────── skills & opportunity fit ───────────── */

export function skillEvidence(w: World, skillId: string) {
  return linksOf(w, "skill", skillId)
    .filter((l) => l.relation === "evidences" && l.fromType === "project")
    .map((l) => w.idx.project.get(l.fromId))
    .filter((p): p is World["projects"][number] => !!p);
}

export interface OpportunityFit {
  score: number; // 0..1
  matched: { name: string; have: number; need: number; evidencedBy: string[] }[];
  gaps: { name: string; have: number; need: number; essential: boolean }[];
  contacts: { personId: string; name: string; relation: string }[];
  visaRisk: { blocked: boolean; text: string | null };
  linkedProjects: string[];
  components: { factor: string; value: number; note: string }[];
}

export function hasVisaConstraint(w: World) {
  return w.credentials.some((c) => c.kind === "visa" && c.status === "earned" && c.expiresAt) || w.memories.some((m) => m.status === "active" && /sponsor/i.test(m.content));
}

export function opportunityVisaText(w: World, oppId: string): { blocked: boolean; text: string | null } {
  const opp = w.idx.opportunity.get(oppId);
  const docIds = linksOf(w, "opportunity", oppId).filter((l) => l.fromType === "document" || l.toType === "document").map((l) => (l.fromType === "document" ? l.fromId : l.toId));
  const fieldText = w.documentFields.find((f) => docIds.includes(f.documentId) && f.key === "visa")?.value ?? null;
  const text = fieldText ?? (opp?.description && /sponsor/i.test(opp.description) ? opp.description : null);
  const blocked = !!text && /(unable to|cannot|can't|do not|don't|no)\s+(offer\s+)?(visa\s+)?sponsor/i.test(text);
  return { blocked, text };
}

export function opportunityFit(w: World, oppId: string): OpportunityFit {
  const reqs = w.opportunitySkills.filter((r) => r.opportunityId === oppId);
  const matched: OpportunityFit["matched"] = [];
  const gaps: OpportunityFit["gaps"] = [];
  let earned = 0;
  let possible = 0;
  for (const r of reqs) {
    const skill = w.idx.skill.get(r.skillId);
    if (!skill) continue;
    const weight = r.essential ? 1 : 0.5;
    possible += weight;
    earned += weight * clamp(skill.level / Math.max(1, r.requiredLevel));
    if (skill.level >= r.requiredLevel) matched.push({ name: skill.name, have: skill.level, need: r.requiredLevel, evidencedBy: skillEvidence(w, skill.id).map((p) => p.title) });
    else gaps.push({ name: skill.name, have: skill.level, need: r.requiredLevel, essential: r.essential });
  }
  const coverage = possible ? earned / possible : 0.5;
  const evidenced = matched.filter((m) => m.evidencedBy.length).length;
  const evidenceBoost = matched.length ? (evidenced / matched.length) * 0.1 : 0;
  const contacts = linksOf(w, "opportunity", oppId)
    .filter((l) => l.fromType === "person")
    .map((l) => ({ personId: l.fromId, name: w.idx.person.get(l.fromId)?.name ?? "?", relation: l.relation }));
  const opp = w.idx.opportunity.get(oppId);
  if (opp?.contactPersonId && !contacts.some((c) => c.personId === opp.contactPersonId))
    contacts.push({ personId: opp.contactPersonId, name: w.idx.person.get(opp.contactPersonId)?.name ?? "?", relation: "contact" });
  const contactBoost = contacts.length ? 0.08 : 0;
  const visa = opportunityVisaText(w, oppId);
  const visaPenalty = visa.blocked && hasVisaConstraint(w) ? 0.35 : 0;
  const linkedProjects = linksOf(w, "opportunity", oppId)
    .filter((l) => l.fromType === "project")
    .map((l) => w.idx.project.get(l.fromId)?.title ?? "");
  const score = clamp(coverage * 0.82 + evidenceBoost + contactBoost - visaPenalty);
  return {
    score,
    matched,
    gaps,
    contacts,
    visaRisk: visa,
    linkedProjects,
    components: [
      { factor: "Skill coverage", value: Number((coverage * 0.82).toFixed(2)), note: `${matched.length}/${reqs.length} required skills at level` },
      { factor: "Evidence", value: Number(evidenceBoost.toFixed(2)), note: `${evidenced} matched skills backed by projects` },
      { factor: "Warm contact", value: contactBoost, note: contacts.length ? contacts.map((c) => c.name).join(", ") : "no known contact" },
      ...(visaPenalty ? [{ factor: "Visa", value: -visaPenalty, note: "Employer states no sponsorship; you need sponsorship" }] : []),
    ],
  };
}

/** Annualised midpoint value of an opportunity in £ (ESTIMATE). */
export function annualValue(opp: World["opportunities"][number]): number | null {
  if (opp.valueLow === null && opp.valueHigh === null) return null;
  const mid = ((opp.valueLow ?? opp.valueHigh ?? 0) + (opp.valueHigh ?? opp.valueLow ?? 0)) / 2;
  switch (opp.valuePeriod) {
    case "per_month":
      return mid * 12;
    case "per_day":
      return mid * (opp.effortHours ? Math.round((opp.effortHours / 8) * 13) : 60);
    case "one_off":
      return mid;
    default:
      return mid;
  }
}

/* ───────────── relationships ───────────── */

export function relationshipHeat(p: World["people"][number], now: Date) {
  const since = daysSince(p.lastContactAt, now) ?? 999;
  // stronger ties tolerate less silence before cooling
  const tolerance = [0, 120, 90, 60, 45, 30][p.strength] ?? 60;
  return { daysSince: since, tolerance, cooling: since > tolerance, heat: clamp(1 - since / (tolerance * 2)) };
}

export function isOpenOpp(o: World["opportunities"][number]) {
  return !["won", "lost", "dismissed"].includes(o.status);
}

export function deadlineIn(date: string | null, now: Date) {
  return daysUntil(date, now);
}
