/**
 * TODAY briefing: composes ranked actions, blind spots, a system insight and the agenda
 * into the first thing the user sees. Pure function of the World.
 */
import { daysUntil, hours, plural, relativeDay } from "@/lib/format";
import type { Insight } from "@/lib/types";
import { rankActions } from "./actions";
import { whatAmIMissing } from "./missing";
import { financeSummary, goalProgress, isOpenOpp, projectProgress, timeAllocation } from "./signals";
import type { World } from "./world";
import { insight } from "./insight";

export interface Briefing {
  greeting: string;
  headline: string;
  meaningfulCount: number;
  actions: Insight[];
  missing: Insight[];
  systemInsight: Insight | null;
  agenda: { id: string; title: string; when: string; kind: string; startsAt: string; href?: string }[];
  deadlines: { label: string; date: string; days: number; ref: { type: string; id: string }; source: string }[];
  stats: { label: string; value: string; hint: string }[];
  allocation: ReturnType<typeof timeAllocation>;
  generatedAt: string;
}

function localHour(now: Date, tz: string) {
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(now));
  } catch {
    return now.getUTCHours();
  }
}

export function buildBriefing(w: World): Briefing {
  const actions = rankActions(w);
  const missing = whatAmIMissing(w);
  const actionRefKeys = new Set(actions.slice(0, 5).flatMap((a) => (a.refs ?? []).map((r) => `${r.type}:${r.id}`)));
  const missingFiltered = missing.filter((m) => m.kind !== "pattern" || m.detector !== "timeMisallocation").filter((m) => !(m.refs ?? []).some((r) => actionRefKeys.has(`${r.type}:${r.id}`)) || m.severity === "critical");

  const hour = localHour(w.now, w.user.timezone);
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const meaningful = actions.filter((a) => (a.score ?? 0) >= 0.85).length;

  const alloc7 = timeAllocation(w, 7);
  const allocInsight = missing.find((m) => m.detector === "timeMisallocation") ?? null;
  const systemInsight =
    allocInsight ??
    (alloc7.totalMinutes > 0
      ? insight({
          key: "system:allocation",
          kind: "pattern",
          title: "Time allocation this week",
          conclusion: `${hours(alloc7.totalMinutes)} logged across ${plural(alloc7.byGoal.length, "area")}. Largest share: “${alloc7.byGoal[0]?.title}” at ${Math.round((alloc7.byGoal[0]?.share ?? 0) * 100)}%.`,
          evidence: alloc7.byGoal.slice(0, 4).map((g) => ({ text: `${g.title}: ${hours(g.minutes)}`, provenance: "fact" as const })),
          confidenceScore: 0.6,
          severity: "info",
        })
      : null);

  const upcoming = [...w.events]
    .filter((e) => {
      const d = daysUntil(e.startsAt, w.now);
      return d !== null && d >= 0 && d <= 2;
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map((e) => ({
      id: e.id,
      title: e.title,
      when: relativeDay(e.startsAt, w.now),
      kind: e.kind,
      startsAt: e.startsAt.toISOString(),
      href: e.opportunityId ? `/opportunities/${e.opportunityId}` : e.projectId ? `/projects/${e.projectId}` : undefined,
    }));

  const deadlines: Briefing["deadlines"] = [];
  const push = (label: string, date: string | null, ref: { type: string; id: string }, source: string) => {
    const d = daysUntil(date, w.now);
    if (date && d !== null && d >= -3 && d <= 14) deadlines.push({ label, date, days: d, ref, source });
  };
  for (const t of w.tasks.filter((t) => t.status !== "done" && t.status !== "cancelled")) push(t.title, t.dueDate, { type: "task", id: t.id }, "task");
  for (const o of w.opportunities.filter(isOpenOpp)) push(`${o.title} closes`, o.deadline, { type: "opportunity", id: o.id }, "opportunity");
  for (const c of w.commitments.filter((c) => c.status === "open")) push(c.title, c.dueDate, { type: "commitment", id: c.id }, "commitment");
  for (const f of w.documentFields.filter((f) => ["due_date", "notice_deadline", "reply_by"].includes(f.key))) {
    const doc = w.idx.document.get(f.documentId);
    if (doc && !(doc.kind === "invoice" && f.key === "due_date" && /sole trader/i.test(w.documentFields.find((x) => x.documentId === doc.id && x.key === "vendor")?.value ?? "")))
      push(`${f.label} — ${doc.title}`, f.value, { type: "document", id: doc.id }, "document");
  }
  deadlines.sort((a, b) => a.days - b.days);

  const fin = financeSummary(w);
  const activeProjects = w.projects.filter((p) => p.status === "active" || p.status === "blocked");
  const avgProgress = activeProjects.length ? activeProjects.reduce((a, p) => a + projectProgress(w, p.id).pct, 0) / activeProjects.length : 0;
  const goalAvg = w.goals.filter((g) => g.status === "active").map(goalProgress).filter((x): x is number => x !== null);

  return {
    greeting: `Good ${part}, ${w.user.name.split(" ")[0]}.`,
    headline:
      meaningful > 0
        ? `You have ${plural(meaningful, "meaningful thing")} competing for your attention today.`
        : "Nothing urgent is competing for your attention. A good day for deep work on your top goal.",
    meaningfulCount: meaningful,
    actions: actions.slice(0, 5),
    missing: missingFiltered.slice(0, 5),
    systemInsight,
    agenda: upcoming,
    deadlines: deadlines.slice(0, 8),
    stats: [
      { label: "Open opportunities", value: String(w.opportunities.filter(isOpenOpp).length), hint: `${w.applications.filter((a) => ["submitted", "screening", "interview"].includes(a.status)).length} live applications` },
      { label: "Project momentum", value: `${Math.round(avgProgress * 100)}%`, hint: `avg progress · ${activeProjects.length} active` },
      { label: "Goal progress", value: goalAvg.length ? `${Math.round((goalAvg.reduce((a, b) => a + b, 0) / goalAvg.length) * 100)}%` : "—", hint: `${w.goals.filter((g) => g.status === "active").length} active goals` },
      { label: "Runway", value: Number.isFinite(fin.runwayMonths) ? `${fin.runwayMonths.toFixed(1)} mo` : "∞", hint: "liquid cash ÷ essential costs (estimate)" },
    ],
    allocation: alloc7,
    generatedAt: w.now.toISOString(),
  };
}
