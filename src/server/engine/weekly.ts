/**
 * Weekly Intelligence Report and change detection ("what changed since…").
 * All sections are computed from recorded activity; recommendations carry their reasons.
 */
import { daysSince, daysUntil, hours, money, relativeDay, shortDate } from "@/lib/format";
import type { Insight } from "@/lib/types";
import { rankActions } from "./actions";
import { whatAmIMissing } from "./missing";
import { financeSummary, goalProgress, isOpenOpp, projectLastActivity, projectProgress, relationshipHeat, timeAllocation } from "./signals";
import type { World } from "./world";

export interface ChangeItem {
  at: string;
  summary: string;
  entityType: string;
  entityId: string | null;
  kind: "created" | "completed" | "status" | "contact" | "document" | "message" | "other";
}

export function whatChanged(w: World, sinceDays = 7): ChangeItem[] {
  const since = w.now.getTime() - sinceDays * 86_400_000;
  const items: ChangeItem[] = [];
  for (const a of w.activities) {
    if (a.occurredAt.getTime() < since || a.action === "worked") continue;
    items.push({
      at: a.occurredAt.toISOString(),
      summary: a.summary,
      entityType: a.entityType,
      entityId: a.entityId,
      kind: a.action === "completed" ? "completed" : a.action === "created" ? "created" : a.action === "status_changed" ? "status" : a.action === "contacted" ? "contact" : a.action === "uploaded" ? "document" : "other",
    });
  }
  for (const m of w.messages) if (m.occurredAt.getTime() >= since && m.direction === "in") items.push({ at: m.occurredAt.toISOString(), summary: `Message from ${w.idx.person.get(m.personId ?? "")?.name ?? "unknown"}: ${m.subject ?? m.body?.slice(0, 60)}`, entityType: "message", entityId: m.id, kind: "message" });
  for (const o of w.opportunities) if (o.discoveredAt.getTime() >= since && !items.some((i) => i.entityId === o.id && i.kind === "created")) items.push({ at: o.discoveredAt.toISOString(), summary: `New opportunity: ${o.title}`, entityType: "opportunity", entityId: o.id, kind: "created" });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  headline: string;
  wins: string[];
  progress: { goal: string; goalId: string; minutes: number; progress: number | null; trend: string }[];
  stalledProjects: { id: string; title: string; idleDays: number; pct: number }[];
  missedCommitments: { title: string; due: string; to: string | null }[];
  newOpportunities: { id: string; title: string; source: string }[];
  importantChanges: ChangeItem[];
  upcomingDeadlines: { label: string; date: string; days: number }[];
  skillDevelopment: { skill: string; note: string }[];
  finance: { income: number; expenses: number; avgWeeklyExpenses: number; notable: string[] };
  relationshipFollowUps: { name: string; id: string; reason: string }[];
  patterns: Insight[];
  focus: { title: string; why: string; goal: string | null }[];
  allocation: ReturnType<typeof timeAllocation>;
}

export function weeklyReport(w: World): WeeklyReport {
  const end = w.now;
  const start = new Date(end.getTime() - 7 * 86_400_000);
  const inWeek = (d: Date | null | undefined) => !!d && d.getTime() >= start.getTime() && d.getTime() <= end.getTime();

  const completed = w.tasks.filter((t) => t.status === "done" && inWeek(t.completedAt));
  const statusWins = w.activities.filter((a) => inWeek(a.occurredAt) && a.action === "status_changed" && /won|moved|offer|interview|second-round/i.test(a.summary));
  const decided = w.decisions.filter((d) => inWeek(d.decidedAt));
  const wins = [
    ...completed.map((t) => `Completed “${t.title}”${t.projectId ? ` (${w.idx.project.get(t.projectId)?.title})` : ""}`),
    ...statusWins.map((a) => a.summary),
    ...decided.map((d) => `Decided: ${d.title}`),
  ];

  const alloc = timeAllocation(w, 7);
  const prevAlloc = timeAllocation({ ...w, now: start }, 7);
  const progress = w.goals
    .filter((g) => g.status === "active")
    .map((g) => {
      const minutes = alloc.byGoal.find((x) => x.goalId === g.id)?.minutes ?? 0;
      const prev = prevAlloc.byGoal.find((x) => x.goalId === g.id)?.minutes ?? 0;
      return { goal: g.title, goalId: g.id, minutes, progress: goalProgress(g), trend: minutes > prev * 1.2 ? "up" : minutes < prev * 0.8 ? "down" : "flat" };
    })
    .sort((a, b) => b.minutes - a.minutes);

  const stalledProjects = w.projects
    .filter((p) => p.status === "active" || p.status === "blocked")
    .map((p) => ({ p, idle: daysSince(projectLastActivity(w, p.id), w.now) ?? 99 }))
    .filter((x) => x.idle >= 7)
    .map((x) => ({ id: x.p.id, title: x.p.title, idleDays: x.idle, pct: projectProgress(w, x.p.id).pct }));

  const missedCommitments = [
    ...w.commitments.filter((c) => c.status === "open" && (daysUntil(c.dueDate, w.now) ?? 1) < 0).map((c) => ({ title: c.title, due: c.dueDate!, to: c.toPersonId ? (w.idx.person.get(c.toPersonId)?.name ?? null) : null })),
    ...w.tasks.filter((t) => !["done", "cancelled"].includes(t.status) && (daysUntil(t.dueDate, w.now) ?? 1) < 0).map((t) => ({ title: t.title, due: t.dueDate!, to: null })),
  ];

  const newOpportunities = w.opportunities.filter((o) => inWeek(o.discoveredAt)).map((o) => ({ id: o.id, title: o.title, source: o.source.replace("_", " ") }));
  const upcomingDeadlines = [
    ...w.opportunities.filter(isOpenOpp).map((o) => ({ label: `${o.title} closes`, date: o.deadline })),
    ...w.tasks.filter((t) => t.status !== "done").map((t) => ({ label: t.title, date: t.dueDate })),
    ...w.events.filter((e) => ["exam", "interview"].includes(e.kind)).map((e) => ({ label: e.title, date: e.startsAt.toISOString().slice(0, 10) })),
  ]
    .filter((d) => d.date && (daysUntil(d.date, w.now) ?? -1) >= 0 && (daysUntil(d.date, w.now) ?? 99) <= 14)
    .map((d) => ({ label: d.label, date: d.date!, days: daysUntil(d.date, w.now)! }))
    .sort((a, b) => a.days - b.days);

  const skillDevelopment = w.skills
    .filter((k) => inWeek(k.lastPracticedAt))
    .map((k) => ({ skill: k.name, note: `Practised ${relativeDay(k.lastPracticedAt, w.now)} · level ${k.level}/5` }))
    .concat(w.courses.filter((c) => c.status === "in_progress").map((c) => ({ skill: c.title, note: `${c.hoursDone}/${c.hoursTotal ?? "?"}h complete` })));

  const weekTx = w.transactions.filter((t) => inWeek(new Date(`${t.occurredOn}T12:00:00Z`)));
  const fin = financeSummary(w);
  const income = weekTx.filter((t) => t.kind === "income").reduce((a, t) => a + t.amount, 0);
  const expenses = weekTx.filter((t) => t.kind === "expense").reduce((a, t) => a - t.amount, 0);
  const notable = weekTx.filter((t) => t.kind === "expense" && -t.amount >= 40).map((t) => `${t.description}: ${money(-t.amount)} (${shortDate(t.occurredOn)})`);

  const relationshipFollowUps = [
    ...w.messages.filter((m) => m.direction === "in" && m.needsReply).map((m) => ({ name: w.idx.person.get(m.personId ?? "")?.name ?? "Unknown", id: m.personId ?? "", reason: `Waiting for your reply since ${shortDate(m.occurredAt)}` })),
    ...w.people.filter((p) => p.strength >= 3 && relationshipHeat(p, w.now).cooling).map((p) => ({ name: p.name, id: p.id, reason: `No contact for ${relationshipHeat(p, w.now).daysSince} days` })),
  ].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);

  const patterns = whatAmIMissing(w).filter((i) => i.kind === "pattern");
  const actions = rankActions(w);
  const seenGoals = new Set<string>();
  const focus: WeeklyReport["focus"] = [];
  for (const a of actions) {
    const goal = a.scoreBreakdown?.[0]?.note.match(/Goal “(.+?)”/)?.[1] ?? null;
    if (goal && seenGoals.has(goal)) continue;
    if (goal) seenGoals.add(goal);
    focus.push({ title: a.title, why: a.conclusion, goal });
    if (focus.length >= 3) break;
  }

  const top = w.goals.filter((g) => g.status === "active").sort((a, b) => b.priority - a.priority)[0];
  const topShare = alloc.byGoal.find((g) => g.goalId === top?.id)?.share ?? 0;
  return {
    weekStart: start.toISOString().slice(0, 10),
    weekEnd: end.toISOString().slice(0, 10),
    headline: `${wins.length} win${wins.length === 1 ? "" : "s"}, ${hours(alloc.totalMinutes)} of logged work, ${stalledProjects.length} stalled project${stalledProjects.length === 1 ? "" : "s"}. ${top ? `Your top goal received ${Math.round(topShare * 100)}% of logged time.` : ""}`,
    wins,
    progress,
    stalledProjects,
    missedCommitments,
    newOpportunities,
    importantChanges: whatChanged(w, 7).filter((c) => c.kind !== "message").slice(0, 10),
    upcomingDeadlines: upcomingDeadlines.slice(0, 10),
    skillDevelopment,
    finance: { income, expenses, avgWeeklyExpenses: fin.monthlyExpenses / 4.33, notable },
    relationshipFollowUps,
    patterns,
    focus,
    allocation: alloc,
  };
}
