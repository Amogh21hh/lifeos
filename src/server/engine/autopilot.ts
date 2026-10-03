/**
 * Project Autopilot: "Move this project forward."
 *
 * Inspects the project's real state (tasks, estimates, dependencies, deadlines, linked people,
 * documents and opportunities) and produces a concrete execution plan whose first step is the
 * smallest useful next action — specific enough to start immediately.
 */
import { daysUntil, hours, relativeDay, shortDate } from "@/lib/format";
import type { EntityRef, Insight, PlanStep } from "@/lib/types";
import { fact, insight } from "./insight";
import { isOpenOpp, projectLastActivity, projectProgress } from "./signals";
import { linksOf, refOf, type World } from "./world";

export interface AutopilotPlan {
  projectId: string;
  title: string;
  state: string;
  progressPct: number;
  smallestNextAction: PlanStep | null;
  steps: PlanStep[];
  blockers: { task: string; reason: string; unblockWith: string | null }[];
  risks: Insight[];
  people: EntityRef[];
  documents: EntityRef[];
  opportunities: EntityRef[];
  eta: string;
  rationale: string;
}

function weeklyMinutes(w: World, projectId: string) {
  const since = w.now.getTime() - 21 * 86_400_000;
  const ids = new Set((w.idx.tasksByProject.get(projectId) ?? []).map((t) => t.id));
  let m = 0;
  for (const a of w.activities) if (a.minutesSpent && a.occurredAt.getTime() >= since && ((a.entityType === "project" && a.entityId === projectId) || (a.entityType === "task" && ids.has(a.entityId ?? "")))) m += a.minutesSpent;
  return m / 3;
}

function detailFor(w: World, t: World["tasks"][number], project: World["projects"][number]): string {
  const parts: string[] = [];
  if (t.description) parts.push(t.description);
  const reviewer = linksOf(w, "project", project.id).find((l) => l.relation === "reviews");
  if (reviewer && /send|share|draft|review/i.test(t.title)) {
    const ev = w.events.find((e) => e.personId === reviewer.fromId && e.startsAt > w.now);
    if (ev) parts.push(`${w.idx.person.get(reviewer.fromId)?.name} reviews it ${relativeDay(ev.startsAt, w.now)} — send at least 24h before.`);
  }
  const unblocks = w.tasks.filter((x) => x.dependsOnTaskId === t.id && x.status !== "done");
  if (unblocks.length) parts.push(`Unblocks: ${unblocks.map((u) => u.title).join("; ")}.`);
  if (t.dueDate) parts.push(`Due ${relativeDay(t.dueDate, w.now)} (${shortDate(t.dueDate)}).`);
  return parts.join(" ") || `Open the project and complete “${t.title}”. Stop when the output exists, not when time runs out.`;
}

export function moveProjectForward(w: World, projectId: string): AutopilotPlan {
  const p = w.idx.project.get(projectId);
  if (!p) throw new Error("Project not found");
  const prog = projectProgress(w, p.id);
  const open = prog.remaining.filter((t) => t.status !== "cancelled");
  const isBlocked = (t: World["tasks"][number]) => t.status === "blocked" || (!!t.dependsOnTaskId && w.idx.task.get(t.dependsOnTaskId)?.status !== "done");
  const unblocked = open.filter((t) => !isBlocked(t));
  const blocked = open.filter(isBlocked);

  const blockers = blocked.map((t) => {
    const dep = t.dependsOnTaskId ? w.idx.task.get(t.dependsOnTaskId) : undefined;
    return { task: t.title, reason: t.blockedReason ?? (dep ? `Waiting on “${dep.title}”` : "Blocked"), unblockWith: dep && dep.status !== "done" ? dep.title : null };
  });

  // Order: things that unblock others first, then due-date, then smallest effort.
  const unblockValue = (t: World["tasks"][number]) => w.tasks.filter((x) => x.dependsOnTaskId === t.id && x.status !== "done").length;
  const ordered = [...unblocked].sort(
    (a, b) =>
      unblockValue(b) - unblockValue(a) ||
      (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") ||
      (a.estimateMinutes ?? 60) - (b.estimateMinutes ?? 60),
  );

  const steps: PlanStep[] = ordered.slice(0, 5).map((t) => ({
    title: t.title,
    detail: detailFor(w, t, p),
    minutes: t.estimateMinutes ?? undefined,
    why: unblockValue(t) ? `Unblocks ${unblockValue(t)} downstream task(s)` : t.dueDate ? `Due ${relativeDay(t.dueDate, w.now)}` : "Next open task by priority and size",
    refs: [refOf(w, "task", t.id)],
    kind: /send|email|message|ask/i.test(t.title) ? "ask" : "do",
  }));

  // Evidence linkage: if this project's output strengthens live applications, add a concrete step.
  const evidenced = linksOf(w, "project", p.id).filter((l) => l.relation === "evidences").map((l) => l.toId);
  const linkedOpps = new Set(linksOf(w, "project", p.id).map((l) => (l.fromType === "opportunity" ? l.fromId : l.toType === "opportunity" ? l.toId : "")).filter(Boolean));
  const relevantOpps = w.opportunities
    .filter((o) => isOpenOpp(o) && o.type === "job")
    .map((o) => ({ o, shared: w.opportunitySkills.filter((r) => r.opportunityId === o.id && evidenced.includes(r.skillId)).map((r) => w.idx.skill.get(r.skillId)!.name) }))
    .filter((x) => x.shared.length >= 2)
    .sort((a, b) => (daysUntil(a.o.deadline, w.now) ?? 999) - (daysUntil(b.o.deadline, w.now) ?? 999));
  const firstUnlinked = relevantOpps.find((x) => !linkedOpps.has(x.o.id));
  if (firstUnlinked && prog.pct >= 0.5)
    steps.push({
      title: `Add this project as evidence in the ${firstUnlinked.o.title.split("—").pop()?.trim()} application`,
      detail: `Write one CV bullet: what you built, the method (${firstUnlinked.shared.join(", ")}), and one quantified result. Link the write-up.${firstUnlinked.o.deadline ? ` Application closes ${relativeDay(firstUnlinked.o.deadline, w.now)}.` : ""}`,
      minutes: 20,
      why: `The role requires ${firstUnlinked.shared.join(", ")}, which this project demonstrates`,
      refs: [refOf(w, "opportunity", firstUnlinked.o.id)],
      kind: "prepare",
    });

  // Repeated postponement inside this project → decide to split or cut.
  const stuck = open.filter((t) => t.postponedCount >= 3);
  for (const t of stuck.slice(0, 1))
    steps.push({
      title: `Split “${t.title}” into a 25-minute first step`,
      detail: `Postponed ${t.postponedCount} times. Define the first concrete output (e.g. “read reading 1 and write 5 flashcards”) and schedule it for tomorrow morning.`,
      minutes: 5,
      why: "Repeated postponement signals the task is too big or vague",
      refs: [refOf(w, "task", t.id)],
      kind: "decide",
    });

  if (!open.length)
    steps.push({ title: "Define the next milestone", detail: "All tasks are done. Either mark the project complete or add the next milestone with a measurable output.", minutes: 10, why: "No open tasks", kind: "decide" });

  // The smallest useful next action: unblocking or due-soon work that takes ≤ 30 minutes, else the first step.
  const smallest =
    [...steps].filter((s) => (s.minutes ?? 99) <= 30 && s.kind !== "decide").sort((a, b) => (a.minutes ?? 99) - (b.minutes ?? 99))[0] ??
    (blockers[0]?.unblockWith ? { title: blockers[0].unblockWith, detail: `Unblocks “${blockers[0].task}”.`, why: "Removes the main blocker", kind: "do" as const } : steps[0] ?? null);

  const rate = weeklyMinutes(w, p.id);
  const eta = prog.remainingMinutes === 0 ? "complete" : rate < 15 ? "no recent progress — can't project a finish date" : `~${(prog.remainingMinutes / rate).toFixed(1)} weeks at your recent pace (${hours(rate)}/week)`;

  const risks: Insight[] = [];
  const due = daysUntil(p.dueDate, w.now);
  if (due !== null && rate > 0 && prog.remainingMinutes / rate > Math.max(0.1, due / 7))
    risks.push(
      insight({
        key: `autopilot:late:${p.id}`,
        kind: "project",
        title: "At current pace this misses its due date",
        conclusion: `${hours(prog.remainingMinutes)} remain; recent pace is ${hours(rate)}/week; due ${relativeDay(p.dueDate, w.now)}.`,
        evidence: [fact(w, `Due ${shortDate(p.dueDate)}`, "project", p.id)],
        assumptions: ["Pace = logged time over the last 3 weeks", "Task estimates are accurate"],
        wouldChange: ["Cutting scope", "Moving the date"],
        confidenceScore: 0.65,
        severity: "important",
      }),
    );
  const last = projectLastActivity(w, p.id);
  if (last && (w.now.getTime() - last.getTime()) / 86_400_000 > 10)
    risks.push(insight({ key: `autopilot:stale:${p.id}`, kind: "project", title: "Momentum has stalled", conclusion: `No logged work since ${shortDate(last)}.`, evidence: [fact(w, "Last activity date", "project", p.id)], confidenceScore: 0.75, severity: "watch" }));
  if (blockers.length) risks.push(insight({ key: `autopilot:blocked:${p.id}`, kind: "project", title: `${blockers.length} blocked task(s)`, conclusion: blockers.map((b) => `${b.task}: ${b.reason}`).join("; "), evidence: blocked.map((t) => fact(w, t.title, "task", t.id)), confidenceScore: 0.85, severity: "important" }));

  const people = [
    ...linksOf(w, "project", p.id).filter((l) => l.fromType === "person").map((l) => refOf(w, "person", l.fromId)),
    ...w.events.filter((e) => e.projectId === p.id && e.personId).map((e) => refOf(w, "person", e.personId!)),
  ].filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i);
  const documents = linksOf(w, "project", p.id).filter((l) => l.fromType === "document" || l.toType === "document").map((l) => refOf(w, "document", l.fromType === "document" ? l.fromId : l.toId));
  const opportunities = [...linkedOpps].map((id) => refOf(w, "opportunity", id));

  return {
    projectId: p.id,
    title: p.title,
    state: p.currentState ?? `${prog.doneCount}/${prog.totalCount} tasks done`,
    progressPct: prog.pct,
    smallestNextAction: smallest,
    steps,
    blockers,
    risks,
    people,
    documents,
    opportunities,
    eta,
    rationale: `Plan ordered by: (1) work that unblocks other work, (2) nearest due date, (3) smallest effort. ${open.length} open task(s), ${hours(prog.remainingMinutes)} estimated remaining, ${Math.round(prog.pct * 100)}% complete by effort.`,
  };
}
