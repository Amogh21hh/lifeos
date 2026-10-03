/**
 * "WHAT AM I MISSING?" — blind-spot detectors.
 *
 * Rules of the engine:
 *  1. A detector only fires when it can cite concrete records (no evidence → no insight).
 *  2. Every insight states its assumptions and what would change the conclusion.
 *  3. Detectors are independent and individually testable.
 */
import { daysSince, daysUntil, hours, money, plural, relativeDay, shortDate } from "@/lib/format";
import type { Insight } from "@/lib/types";
import { fact, inference, insight, SEVERITY_RANK, userInput } from "./insight";
import {
  annualValue,
  goalLastActivity,
  isOpenOpp,
  opportunityFit,
  opportunityVisaText,
  relationshipHeat,
  skillEvidence,
  timeAllocation,
  financeSummary,
} from "./signals";
import { linksOf, type World } from "./world";

type Detector = (w: World) => Insight[];

const APPLIED = new Set(["submitted", "screening"]);

export const applicationFollowUps: Detector = (w) => {
  const days = w.settings.followUpDays;
  const live = w.applications.filter((a) => APPLIED.has(a.status) || a.status === "interview");
  const stale = live.filter((a) => a.status !== "interview" && !a.lastFollowUpAt && (daysSince(a.submittedAt, w.now) ?? 0) >= days);
  if (!stale.length) return [];
  const followed = live.filter((a) => a.lastFollowUpAt).length;
  return [
    insight({
      key: "missing:followups",
      kind: "blind_spot",
      detector: "applicationFollowUps",
      title: `${plural(stale.length, "application")} with no follow-up`,
      conclusion: `You have ${plural(live.length, "live application")} but have followed up on only ${followed}. ${stale.length} have been silent for ${days}+ days.`,
      evidence: stale.map((a) => {
        const o = w.idx.opportunity.get(a.opportunityId);
        return fact(w, `${o?.title ?? "Application"} — submitted ${relativeDay(a.submittedAt, w.now)}, no follow-up recorded`, "opportunity", a.opportunityId);
      }),
      assumptions: ["Follow-ups made outside LIFEOS were not logged", `A follow-up after ${days} days is appropriate (your setting)`],
      wouldChange: ["Recording follow-ups sent by email or LinkedIn", "Employers that explicitly ask candidates not to chase"],
      confidenceScore: 0.82,
      severity: stale.length >= 3 ? "important" : "watch",
      refs: stale.map((a) => ({ type: "opportunity" as const, id: a.opportunityId, label: w.idx.opportunity.get(a.opportunityId)?.title ?? "" })),
      actions: [{ label: "Draft follow-up emails", command: "Draft follow-ups for my stale applications", minutes: 15 }],
    }),
  ];
};

export const unansweredMessages: Detector = (w) =>
  w.messages
    .filter((m) => m.direction === "in" && m.needsReply && (daysSince(m.occurredAt, w.now) ?? 0) >= 1)
    .filter((m) => !w.messages.some((o) => o.direction === "out" && o.personId === m.personId && o.occurredAt > m.occurredAt))
    .map((m) => {
      const person = m.personId ? w.idx.person.get(m.personId) : undefined;
      const age = daysSince(m.occurredAt, w.now) ?? 0;
      const opp = m.opportunityId ? w.idx.opportunity.get(m.opportunityId) : undefined;
      const recruiter = person?.relationship === "recruiter";
      return insight({
        key: `missing:reply:${m.id}`,
        kind: "blind_spot",
        detector: "unansweredMessages",
        title: `${person?.name ?? "Someone"} is waiting for a reply (${age}d)`,
        conclusion: `${person?.name ?? "A contact"} messaged you ${relativeDay(m.occurredAt, w.now)}${opp ? ` about ${opp.title}` : ""} and no reply has been recorded.`,
        evidence: [
          fact(w, `${m.channel} received ${shortDate(m.occurredAt)}: “${(m.body ?? m.subject ?? "").slice(0, 140)}”`, "message", m.id),
          ...(opp?.deadline ? [fact(w, `Related deadline ${relativeDay(opp.deadline, w.now)} (${shortDate(opp.deadline)})`, "opportunity", opp.id)] : []),
        ],
        assumptions: ["No reply was sent from a channel LIFEOS can't see"],
        wouldChange: ["A reply sent outside connected channels"],
        confidenceScore: 0.85,
        severity: recruiter || (opp && (daysUntil(opp.deadline, w.now) ?? 99) <= 7) ? "important" : "watch",
        refs: [...(person ? [{ type: "person" as const, id: person.id, label: person.name }] : []), ...(opp ? [{ type: "opportunity" as const, id: opp.id, label: opp.title }] : [])],
        actions: [{ label: `Draft reply to ${person?.name.split(" ")[0] ?? "contact"}`, command: `Draft a reply to ${person?.name ?? "this message"}`, minutes: 10 }],
      });
    });

export const unlinkedEvidence: Detector = (w) => {
  const out: Insight[] = [];
  for (const p of w.projects.filter((p) => p.status !== "paused")) {
    const evidenced = linksOf(w, "project", p.id).filter((l) => l.relation === "evidences" && l.toType === "skill").map((l) => l.toId);
    if (!evidenced.length) continue;
    const linkedOpps = new Set(linksOf(w, "project", p.id).filter((l) => l.toType === "opportunity" || l.fromType === "opportunity").map((l) => (l.toType === "opportunity" ? l.toId : l.fromId)));
    const matches = w.opportunities
      .filter((o) => isOpenOpp(o) && !linkedOpps.has(o.id))
      .map((o) => ({ o, skills: w.opportunitySkills.filter((r) => r.opportunityId === o.id && evidenced.includes(r.skillId)).map((r) => w.idx.skill.get(r.skillId)!.name) }))
      .filter((m) => m.skills.length >= 2 && m.skills.some((n) => w.skills.find((k) => k.name === n)?.category !== "tool") && ["job", "freelance", "event"].includes(m.o.type));
    if (matches.length < 2) continue;
    const skillNames = [...new Set(matches.flatMap((m) => m.skills))];
    out.push(
      insight({
        key: `missing:unlinked:${p.id}`,
        kind: "blind_spot",
        detector: "unlinkedEvidence",
        title: `“${p.title}” isn't linked to ${matches.length} opportunities it could strengthen`,
        conclusion: `This project demonstrates ${skillNames.join(", ")} — requested by ${plural(matches.length, "open opportunity", "open opportunities")} — but it isn't referenced in any of them.`,
        evidence: [
          fact(w, `Project evidences: ${evidenced.map((id) => w.idx.skill.get(id)?.name).join(", ")}`, "project", p.id),
          ...matches.slice(0, 5).map((m) => fact(w, `${m.o.title} requires ${m.skills.join(", ")}`, "opportunity", m.o.id)),
        ],
        assumptions: ["Linking evidence to applications (CV bullets, cover letters, portfolio links) improves response rates"],
        wouldChange: ["If the project is not yet presentable to employers", "If these opportunities are no longer being pursued"],
        confidenceScore: 0.72,
        severity: "important",
        refs: [{ type: "project", id: p.id, label: p.title }, ...matches.map((m) => ({ type: "opportunity" as const, id: m.o.id, label: m.o.title }))],
        actions: [{ label: "Link project as evidence", command: `Link ${p.title} to matching opportunities`, minutes: 5 }],
        score: matches.reduce((a, m) => a + m.skills.length + (m.o.type === "job" ? 1 : 0), 0),
      }),
    );
  }
  // Keep the two strongest so the signal isn't drowned in near-duplicates.
  return out.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 2);
};

export const repeatedPostponement: Detector = (w) => {
  const counts = new Map<string, number>();
  for (const a of w.activities) if (a.action === "postponed" && a.entityId) counts.set(a.entityId, (counts.get(a.entityId) ?? 0) + 1);
  return w.tasks
    .filter((t) => t.status !== "done" && t.status !== "cancelled")
    .map((t) => ({ t, n: Math.max(t.postponedCount, counts.get(t.id) ?? 0) }))
    .filter(({ n }) => n >= 3)
    .map(({ t, n }) =>
      insight({
        key: `missing:postponed:${t.id}`,
        kind: "pattern",
        detector: "repeatedPostponement",
        title: `You've postponed “${t.title}” ${n} times`,
        conclusion: `Repeated postponement usually means the task is too large, unclear or unpleasant — not that it's unimportant${t.goalId ? ` (it serves “${w.idx.goal.get(t.goalId)?.title}”)` : ""}.`,
        evidence: [
          fact(w, `Postponed ${n} times; estimate ${t.estimateMinutes ? hours(t.estimateMinutes) : "not set"}`, "task", t.id),
          ...(t.dueDate ? [fact(w, `Due ${relativeDay(t.dueDate, w.now)}`, "task", t.id)] : []),
        ],
        assumptions: ["Postponements logged reflect real deferrals"],
        wouldChange: ["If the task is no longer needed — cancel it instead"],
        confidenceScore: 0.8,
        severity: (t.estimateMinutes ?? 0) > 120 ? "important" : "watch",
        refs: [{ type: "task", id: t.id, label: t.title }],
        actions: [{ label: "Split into a 25-minute first step", command: `Break down task "${t.title}" into smaller steps`, minutes: 5 }],
      }),
    );
};

export const cheapUnblocks: Detector = (w) => {
  const out: Insight[] = [];
  for (const t of w.tasks.filter((t) => t.status === "blocked" || (t.dependsOnTaskId && t.status !== "done"))) {
    const blocker = t.dependsOnTaskId ? w.idx.task.get(t.dependsOnTaskId) : undefined;
    if (!blocker || blocker.status === "done") continue;
    const project = t.projectId ? w.idx.project.get(t.projectId) : undefined;
    const downstream = w.tasks.filter((x) => x.dependsOnTaskId === t.id && x.status !== "done");
    out.push(
      insight({
        key: `missing:unblock:${blocker.id}`,
        kind: "blind_spot",
        detector: "cheapUnblocks",
        title: `${blocker.estimateMinutes && blocker.estimateMinutes <= 30 ? `A ${blocker.estimateMinutes}-minute task` : "An unresolved dependency"} is blocking ${project ? `“${project.title}”` : "progress"}`,
        conclusion: `“${blocker.title}” must be done before “${t.title}”${downstream.length ? ` and ${plural(downstream.length, "further task")}` : ""} can start.`,
        evidence: [
          fact(w, `Blocked task: ${t.title}${t.blockedReason ? ` (${t.blockedReason})` : ""}`, "task", t.id),
          fact(w, `Blocker: ${blocker.title} — status ${blocker.status}, estimate ${blocker.estimateMinutes ? hours(blocker.estimateMinutes) : "unknown"}`, "task", blocker.id),
          ...(project ? [fact(w, `Project status: ${project.status}`, "project", project.id)] : []),
        ],
        assumptions: ["The dependency recorded is still accurate"],
        wouldChange: ["If the blocked work can start with partial inputs"],
        confidenceScore: 0.86,
        severity: (blocker.estimateMinutes ?? 99) <= 30 ? "important" : "watch",
        refs: [{ type: "task", id: blocker.id, label: blocker.title }, ...(project ? [{ type: "project" as const, id: project.id, label: project.title }] : [])],
        actions: [{ label: `Do “${blocker.title}”`, minutes: blocker.estimateMinutes ?? undefined }],
      }),
    );
  }
  return out;
};

export const goalsWithoutNextAction: Detector = (w) =>
  w.goals
    .filter((g) => g.status === "active" && g.priority >= 3)
    .filter((g) => {
      const projectIds = w.projects.filter((p) => p.goalId === g.id && p.status !== "done").map((p) => p.id);
      const open = w.tasks.filter((t) => (t.goalId === g.id || (t.projectId && projectIds.includes(t.projectId))) && ["todo", "in_progress"].includes(t.status));
      return open.length === 0;
    })
    .map((g) =>
      insight({
        key: `missing:nonext:${g.id}`,
        kind: "blind_spot",
        detector: "goalsWithoutNextAction",
        title: `“${g.title}” has no next action`,
        conclusion: `There is no open task or active project moving this goal forward, so it can only progress by accident.`,
        evidence: [
          fact(w, `Goal priority ${g.priority}/5, ${g.targetDate ? `target ${shortDate(g.targetDate)}` : "no target date"}`, "goal", g.id),
          fact(w, `0 open tasks across ${plural(w.projects.filter((p) => p.goalId === g.id).length, "linked project")}`, "goal", g.id),
        ],
        assumptions: ["All work towards this goal is tracked in LIFEOS"],
        wouldChange: ["If the goal is deliberately on hold — mark it paused"],
        confidenceScore: 0.9,
        severity: g.priority >= 4 ? "important" : "watch",
        refs: [{ type: "goal", id: g.id, label: g.title }],
        actions: [{ label: "Define a measurable next step", command: `Suggest the next action for goal "${g.title}"`, minutes: 5 }],
      }),
    );

export const neglectedGoals: Detector = (w) =>
  w.goals
    .filter((g) => g.status === "active" && g.priority >= 2)
    .map((g) => ({ g, last: goalLastActivity(w, g.id) }))
    .filter(({ last }) => (daysSince(last, w.now) ?? 999) >= w.settings.neglectDays)
    .map(({ g, last }) => {
      const d = daysSince(last, w.now) ?? 999;
      return insight({
        key: `missing:neglect:${g.id}`,
        kind: "blind_spot",
        detector: "neglectedGoals",
        title: `“${g.title}” has had no activity for ${d} days`,
        conclusion: `An active priority-${g.priority} goal has gone quiet. Either it needs a small restart or an explicit decision to pause it.`,
        evidence: [
          fact(w, `Last activity ${last ? shortDate(last) : "never"} (${d} days ago)`, "goal", g.id),
          ...(g.targetDate ? [fact(w, `Target date ${shortDate(g.targetDate)} (${relativeDay(g.targetDate, w.now)})`, "goal", g.id)] : []),
        ],
        assumptions: [`Silence for ${w.settings.neglectDays}+ days signals neglect (your setting)`],
        wouldChange: ["Activity done but not logged", "Pausing the goal on purpose"],
        confidenceScore: 0.78,
        severity: g.priority >= 4 ? "important" : "watch",
        refs: [{ type: "goal", id: g.id, label: g.title }],
        actions: [{ label: "Restart with a 20-minute step", command: `Suggest the next action for goal "${g.title}"`, minutes: 20 }],
      });
    });

export const overdueCommitments: Detector = (w) =>
  w.commitments
    .filter((c) => c.status === "open" && c.dueDate && (daysUntil(c.dueDate, w.now) ?? 0) < 0)
    .map((c) => {
      const person = c.toPersonId ? w.idx.person.get(c.toPersonId) : undefined;
      const late = -(daysUntil(c.dueDate, w.now) ?? 0);
      return insight({
        key: `missing:commitment:${c.id}`,
        kind: "blind_spot",
        detector: "overdueCommitments",
        title: `Overdue promise${person ? ` to ${person.name}` : ""}: ${c.title}`,
        conclusion: `This commitment was due ${late} days ago. Unkept small promises erode trust faster than missed big ones.`,
        evidence: [userInput(w, `“${c.title}” due ${shortDate(c.dueDate)}${c.notes ? ` — ${c.notes}` : ""}`, "commitment", c.id)],
        assumptions: ["The commitment is still open"],
        wouldChange: ["If it was completed — mark it done", "If the other person released you from it"],
        confidenceScore: 0.9,
        severity: late > 7 ? "important" : "watch",
        refs: [...(person ? [{ type: "person" as const, id: person.id, label: person.name }] : []), { type: "commitment", id: c.id, label: c.title }],
        actions: [{ label: "Do it or renegotiate", minutes: 10 }],
      });
    });

const DEADLINE_KEYS = new Set(["due_date", "deadline", "notice_deadline", "reply_by", "exam_date", "event_date", "expiry"]);

export const untrackedDocumentDeadlines: Detector = (w) => {
  const out: Insight[] = [];
  const trackedDates = new Set([
    ...w.tasks.filter((t) => t.status !== "done").map((t) => t.dueDate),
    ...w.commitments.filter((c) => c.status === "open").map((c) => c.dueDate),
    ...w.events.map((e) => e.startsAt.toISOString().slice(0, 10)),
    ...w.opportunities.map((o) => o.deadline),
  ]);
  for (const f of w.documentFields) {
    if (!(DEADLINE_KEYS.has(f.key) || f.key.startsWith("deadline_")) || f.valueType !== "date") continue;
    const d = daysUntil(f.value, w.now);
    if (d === null || d < 0 || d > 21) continue;
    const doc = w.idx.document.get(f.documentId);
    if (!doc) continue;
    if (trackedDates.has(f.value) && f.key !== "notice_deadline") continue;
    const titleWords = doc.title.toLowerCase().split(/\W+/).filter((x) => x.length > 4);
    const mentionedByTask = w.tasks.some((t) => t.status !== "done" && titleWords.some((tw) => t.title.toLowerCase().includes(tw)) && t.dueDate);
    if (mentionedByTask) continue;
    out.push(
      insight({
        key: `missing:docdeadline:${f.id}`,
        kind: "blind_spot",
        detector: "untrackedDocumentDeadlines",
        title: `“${doc.title}” contains a deadline ${relativeDay(f.value, w.now)}`,
        conclusion: `${f.label}: ${shortDate(f.value)}. It isn't tracked as a task, commitment or calendar event.`,
        evidence: [
          { text: `${f.label} = ${f.value} (extracted by ${f.method}, confidence ${Math.round(f.confidence * 100)}%)`, provenance: f.key === "notice_deadline" ? "ai_inference" : "fact", ref: { type: "document", id: doc.id, label: doc.title } },
          ...(f.sourceText ? [{ text: `Source: “${f.sourceText.slice(0, 160)}”`, provenance: "fact" as const, ref: { type: "document" as const, id: doc.id, label: doc.title } }] : []),
        ],
        assumptions: [f.key === "notice_deadline" ? "Notice deadline derived as end date minus the notice period in the clause" : "The extracted date is correct"],
        wouldChange: ["If the date was misread — verify it in the document", "If you've already handled it"],
        confidenceScore: Math.min(0.9, f.confidence),
        severity: d <= 2 ? "critical" : d <= 10 ? "important" : "watch",
        refs: [{ type: "document", id: doc.id, label: doc.title }],
        actions: [{ label: "Create a task for this deadline", command: `Create a task for the ${f.label.toLowerCase()} in ${doc.title}`, minutes: 1 }],
      }),
    );
  }
  return out;
};

export const coolingRelationships: Detector = (w) =>
  w.people
    .filter((p) => p.strength >= 3)
    .map((p) => ({ p, heat: relationshipHeat(p, w.now) }))
    .filter(({ heat }) => heat.cooling)
    .map(({ p, heat }) => {
      const links = linksOf(w, "person", p.id).filter((l) => l.toType === "opportunity" || l.fromType === "opportunity");
      const opps = links.map((l) => w.idx.opportunity.get(l.toType === "opportunity" ? l.toId : l.fromId)).filter((o) => o && isOpenOpp(o));
      const pending = w.commitments.filter((c) => c.status === "open" && (c.toPersonId === p.id || c.title.includes(p.name.split(" ")[0])));
      return insight({
        key: `missing:cooling:${p.id}`,
        kind: "blind_spot",
        detector: "coolingRelationships",
        title: `Your connection with ${p.name} is cooling (${heat.daysSince} days)`,
        conclusion: `${p.name} is a strength-${p.strength} relationship${opps.length ? ` connected to ${opps.map((o) => o!.title).join(", ")}` : ""}, but you haven't been in touch for ${heat.daysSince} days.`,
        evidence: [
          fact(w, `Last contact ${shortDate(p.lastContactAt)}; for this tie strength contact usually lapses after ~${heat.tolerance} days`, "person", p.id),
          ...opps.map((o) => fact(w, `Linked opportunity: ${o!.title} (${o!.status})`, "opportunity", o!.id)),
          ...pending.map((c) => userInput(w, `Pending: ${c.title}`, "commitment", c.id)),
        ],
        assumptions: ["Contact outside connected channels isn't logged"],
        wouldChange: ["Recent contact not recorded in LIFEOS"],
        confidenceScore: 0.7,
        severity: opps.length ? "important" : "info",
        refs: [{ type: "person", id: p.id, label: p.name }],
        actions: [{ label: `Message ${p.name.split(" ")[0]}`, command: `Draft a check-in message to ${p.name}`, minutes: 10 }],
      });
    });

export const subscriptionsMisaligned: Detector = (w) => {
  const out: Insight[] = [];
  const fin = financeSummary(w);
  const gym = fin.recurring.find((r) => r.category === "Fitness");
  const healthGoal = w.goals.find((g) => g.category === "health" && g.status === "active");
  if (gym && healthGoal) {
    const runHabit = w.habits.find((h) => h.goalId === healthGoal.id);
    const lastLog = runHabit ? w.habitLogs.filter((l) => l.habitId === runHabit.id).map((l) => l.day).sort().pop() : undefined;
    const idle = daysSince(lastLog ?? goalLastActivity(w, healthGoal.id), w.now) ?? 999;
    if (idle >= 14)
      out.push(
        insight({
          key: "missing:subscription:fitness",
          kind: "pattern",
          detector: "subscriptionsMisaligned",
          title: `Paying ${money(gym.monthly)}/month for ${gym.description} while training has stopped`,
          conclusion: `Your “${healthGoal.title}” goal has had no logged activity for ${idle} days, but the membership keeps renewing.`,
          evidence: [
            fact(w, `${gym.description}: ${money(gym.monthly)}/month, last charged ${shortDate(gym.lastSeen)}`),
            fact(w, `Last ${runHabit?.title ?? "training"} log ${lastLog ? shortDate(lastLog) : "none"} (${idle} days ago)`, "goal", healthGoal.id),
          ],
          assumptions: ["The membership is used only for this goal"],
          wouldChange: ["Gym visits not logged as habit entries", "A planned restart date"],
          confidenceScore: 0.66,
          severity: "watch",
          refs: [{ type: "goal", id: healthGoal.id, label: healthGoal.title }],
          actions: [{ label: "Restart training or freeze membership", command: `What happens if I stop the half-marathon goal?`, minutes: 5 }],
        }),
      );
  }
  return out;
};

export const skillGapClusters: Detector = (w) => {
  const gapCount = new Map<string, { opps: World["opportunities"]; need: number }>();
  for (const o of w.opportunities.filter(isOpenOpp)) {
    for (const r of w.opportunitySkills.filter((r) => r.opportunityId === o.id && r.essential)) {
      const sk = w.idx.skill.get(r.skillId);
      if (!sk || sk.level >= r.requiredLevel) continue;
      const g = gapCount.get(sk.id) ?? { opps: [], need: 0 };
      g.opps.push(o);
      g.need = Math.max(g.need, r.requiredLevel);
      gapCount.set(sk.id, g);
    }
  }
  return [...gapCount.entries()]
    .filter(([, g]) => g.opps.length >= 2)
    .map(([skillId, g]) => {
      const sk = w.idx.skill.get(skillId)!;
      const goal = w.goals.find((x) => x.status === "active" && x.title.toLowerCase().includes(sk.name.toLowerCase()));
      const last = goal ? goalLastActivity(w, goal.id) : sk.lastPracticedAt;
      const value = g.opps.map(annualValue).filter((v): v is number => v !== null);
      return insight({
        key: `missing:skillgap:${skillId}`,
        kind: "pattern",
        detector: "skillGapClusters",
        title: `${sk.name} is a gap in ${g.opps.length} opportunities`,
        conclusion: `You're at level ${sk.level}/5; these roles need ${g.need}. ${last ? `Last practice was ${relativeDay(last, w.now)}.` : ""} Closing this one gap lifts several applications at once.`,
        evidence: [
          fact(w, `${sk.name}: level ${sk.level}/5${skillEvidence(w, skillId).length ? `, evidenced by ${skillEvidence(w, skillId).map((p) => p.title).join(", ")}` : ", no project evidence"}`, "skill", skillId),
          ...g.opps.map((o) => fact(w, `${o.title} requires ${sk.name} ≥ ${w.opportunitySkills.find((r) => r.opportunityId === o.id && r.skillId === skillId)?.requiredLevel}`, "opportunity", o.id)),
          ...(value.length ? [{ text: `Combined midpoint value of affected roles ≈ ${money(value.reduce((a, b) => a + b, 0) / value.length)}/yr each`, provenance: "estimate" as const }] : []),
          ...(goal ? [fact(w, `Related goal “${goal.title}” last active ${relativeDay(last, w.now)}`, "goal", goal.id)] : []),
        ],
        assumptions: ["Self-assessed skill levels are accurate", "Listed requirements are genuinely screened for"],
        wouldChange: ["Evidence of higher skill level (e.g. a finished SQL project)", "Employers relaxing the requirement"],
        confidenceScore: 0.74,
        severity: g.opps.length >= 3 ? "important" : "watch",
        refs: [{ type: "skill", id: skillId, label: sk.name }, ...g.opps.map((o) => ({ type: "opportunity" as const, id: o.id, label: o.title }))],
        actions: [{ label: `Plan ${sk.name} practice`, command: `What happens if I learn ${sk.name}?`, minutes: 5 }],
      });
    });
};

export const decisionReviewsDue: Detector = (w) =>
  w.decisions
    .filter((d) => d.status === "decided" && d.reviewOn && (daysUntil(d.reviewOn, w.now) ?? 1) <= 0)
    .map((d) =>
      insight({
        key: `missing:review:${d.id}`,
        kind: "blind_spot",
        detector: "decisionReviewsDue",
        title: `Decision review due: ${d.title}`,
        conclusion: `You planned to revisit this decision on ${shortDate(d.reviewOn)}. Reviewing outcomes is how decision quality compounds.`,
        evidence: [userInput(w, `Decided ${shortDate(d.decidedAt)}: ${d.outcome ?? "no outcome recorded"}`, "decision", d.id)],
        assumptions: [],
        wouldChange: ["Moving the review date"],
        confidenceScore: 0.95,
        severity: "info",
        refs: [{ type: "decision", id: d.id, label: d.title }],
        actions: [{ label: "Review decision", href: `/decisions/${d.id}`, minutes: 10 }],
      }),
    );

export const visaRunway: Detector = (w) => {
  const visa = w.credentials.find((c) => c.kind === "visa" && c.expiresAt);
  if (!visa) return [];
  const days = daysUntil(visa.expiresAt, w.now) ?? 9999;
  if (days > 540) return [];
  const live = w.opportunities.filter((o) => o.type === "job" && isOpenOpp(o));
  const blocked = live.filter((o) => opportunityVisaText(w, o.id).blocked);
  if (!blocked.length && days > 365) return [];
  return [
    insight({
      key: "missing:visa",
      kind: "blind_spot",
      detector: "visaRunway",
      title: `${blocked.length ? `${plural(blocked.length, "live application")} can't sponsor your visa` : "Visa runway check"}`,
      conclusion: `Your ${visa.name} expires in ${Math.round(days / 30)} months. ${blocked.length ? `${blocked.map((o) => o.title).join(", ")} explicitly won't sponsor — time spent there doesn't move the visa goal.` : ""}`,
      evidence: [
        fact(w, `${visa.name} expires ${shortDate(visa.expiresAt)}`, "credential", visa.id),
        ...blocked.map((o) => fact(w, `${o.title}: “${opportunityVisaText(w, o.id).text?.slice(0, 120)}”`, "opportunity", o.id)),
        inference(`${live.length - blocked.length} of ${live.length} live job opportunities are compatible with sponsorship needs`),
      ],
      assumptions: ["Sponsorship statements in job descriptions are accurate", "A switch to Skilled Worker is needed before expiry"],
      wouldChange: ["Employer confirming sponsorship case-by-case", "Another visa route becoming available"],
      confidenceScore: 0.8,
      severity: blocked.length ? "important" : "watch",
      refs: blocked.map((o) => ({ type: "opportunity" as const, id: o.id, label: o.title })),
    }),
  ];
};

export const quickWins: Detector = (w) => {
  const wins = w.opportunities.filter((o) => isOpenOpp(o) && o.status === "identified" && (o.effortHours ?? 99) <= 0.5 && (daysUntil(o.deadline, w.now) ?? 99) >= 0);
  if (!wins.length) return [];
  return [
    insight({
      key: "missing:quickwins",
      kind: "blind_spot",
      detector: "quickWins",
      title: `${plural(wins.length, "opportunity", "opportunities")} need less than 30 minutes to unlock`,
      conclusion: `Low-effort, open opportunities: ${wins.map((o) => o.title).join("; ")}.`,
      evidence: wins.map((o) => fact(w, `${o.title}: ~${Math.round((o.effortHours ?? 0) * 60)} min${o.deadline ? `, deadline ${relativeDay(o.deadline, w.now)}` : ""}`, "opportunity", o.id)),
      assumptions: ["Effort estimates are realistic"],
      wouldChange: ["If these opportunities are no longer relevant to your goals"],
      confidenceScore: 0.75,
      severity: wins.some((o) => (daysUntil(o.deadline, w.now) ?? 99) <= 3) ? "important" : "watch",
      refs: wins.map((o) => ({ type: "opportunity" as const, id: o.id, label: o.title })),
    }),
  ];
};

export const timeMisallocation: Detector = (w) => {
  const alloc = timeAllocation(w, 7);
  if (alloc.totalMinutes < 300) return [];
  const top = [...w.goals].filter((g) => g.status === "active").sort((a, b) => b.priority - a.priority)[0];
  if (!top) return [];
  const topShare = alloc.byGoal.filter((g) => g.goalId === top.id).reduce((a, g) => a + g.share, 0);
  if (topShare >= 0.25) return [];
  const biggest = alloc.byGoal[0];
  return [
    insight({
      key: "missing:allocation",
      kind: "pattern",
      detector: "timeMisallocation",
      title: `Your top goal got ${Math.round(topShare * 100)}% of your time this week`,
      conclusion: `Activity is concentrated on “${biggest.title}” (${Math.round(biggest.share * 100)}%) while your highest-priority objective “${top.title}” received only ${Math.round(topShare * 100)}% of ${hours(alloc.totalMinutes)} logged.`,
      evidence: alloc.byGoal.slice(0, 5).map((g) => ({ text: `${g.title}: ${hours(g.minutes)} (${Math.round(g.share * 100)}%)`, provenance: "fact" as const, ref: g.goalId ? { type: "goal" as const, id: g.goalId, label: g.title } : undefined })),
      assumptions: ["Logged activity approximates real time use", "Goal priorities are current"],
      wouldChange: ["Untracked work on the top goal", "Re-prioritising goals"],
      confidenceScore: 0.68,
      severity: "important",
      refs: [{ type: "goal", id: top.id, label: top.title }],
      actions: [{ label: "Plan this week around the top goal", command: "What should I focus on this week?", minutes: 10 }],
    }),
  ];
};

export const deadlinesWithoutPrep: Detector = (w) =>
  w.opportunities
    .filter((o) => isOpenOpp(o) && ["identified", "researching", "preparing"].includes(o.status) && o.type === "job")
    .filter((o) => {
      const d = daysUntil(o.deadline, w.now);
      return d !== null && d >= 0 && d <= 7;
    })
    .filter((o) => {
      const company = o.companyId ? w.idx.company.get(o.companyId)?.name.toLowerCase().split(" ")[0] : "";
      return !w.tasks.some((t) => t.status !== "done" && company && t.title.toLowerCase().includes(company));
    })
    .map((o) =>
      insight({
        key: `missing:noprep:${o.id}`,
        kind: "blind_spot",
        detector: "deadlinesWithoutPrep",
        title: `${o.title} closes ${relativeDay(o.deadline, w.now)} with no prep task`,
        conclusion: `There's no task to prepare this application, and the deadline is within a week.`,
        evidence: [fact(w, `Deadline ${shortDate(o.deadline)}, fit ${Math.round(opportunityFit(w, o.id).score * 100)}%`, "opportunity", o.id)],
        assumptions: ["Preparation isn't tracked elsewhere"],
        wouldChange: ["Deciding not to apply"],
        confidenceScore: 0.8,
        severity: "important",
        refs: [{ type: "opportunity", id: o.id, label: o.title }],
        actions: [{ label: "Create prep task", command: `Create a task to prepare the ${o.title} application`, minutes: 1 }],
      }),
    );

export const DETECTORS: Record<string, Detector> = {
  applicationFollowUps,
  unansweredMessages,
  unlinkedEvidence,
  repeatedPostponement,
  cheapUnblocks,
  goalsWithoutNextAction,
  neglectedGoals,
  overdueCommitments,
  untrackedDocumentDeadlines,
  coolingRelationships,
  subscriptionsMisaligned,
  skillGapClusters,
  decisionReviewsDue,
  visaRunway,
  quickWins,
  timeMisallocation,
  deadlinesWithoutPrep,
};

export function whatAmIMissing(w: World): Insight[] {
  const all: Insight[] = [];
  for (const [name, detect] of Object.entries(DETECTORS)) {
    try {
      all.push(...detect(w).map((i) => ({ ...i, detector: name })));
    } catch (err) {
      // A failing detector must never take the whole analysis down.
      console.error(`detector ${name} failed`, err);
    }
  }
  // A goal with no next action is, by definition, also quiet: keep the more actionable insight.
  const noNext = new Set(all.filter((i) => i.detector === "goalsWithoutNextAction").map((i) => i.refs?.[0]?.id));
  const deduped = all.filter((i) => !(i.detector === "neglectedGoals" && noNext.has(i.refs?.[0]?.id)));
  return deduped.sort((a, b) => SEVERITY_RANK[b.severity ?? "info"] - SEVERITY_RANK[a.severity ?? "info"] || b.confidenceScore - a.confidenceScore);
}
