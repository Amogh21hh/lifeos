/**
 * Highest-leverage action ranking.
 *
 * Each candidate action is scored as:
 *
 *   leverage = impact × urgency × confidence ÷ effort
 *
 *   impact     — priority of the goal it serves (1–5 → 0.2–1.0) plus value/fit bonuses
 *   urgency    — 1 + 2·e^(−days/4) for a deadline `days` away (overdue = 3.2)
 *   confidence — how sure we are the action matters (data completeness)
 *   effort     — 1 + 0.5·log2(1 + minutes/30)  (dampened so important deep work isn't drowned by quick tasks)
 *
 * The factors are returned with every action so the UI can show exactly why it ranked where it did.
 */
import { clamp, daysSince, daysUntil, hours, money, relativeDay, shortDate } from "@/lib/format";
import type { Insight } from "@/lib/types";
import { fact, insight, userInput } from "./insight";
import { annualValue, isOpenOpp, opportunityFit, projectProgress } from "./signals";
import { linksOf, type World } from "./world";

interface Candidate {
  key: string;
  title: string;
  reason: string;
  goalId: string | null;
  minutes: number;
  deadlineDays: number | null;
  impactBonus: number;
  confidence: number;
  evidence: Insight["evidence"];
  assumptions: string[];
  wouldChange: string[];
  refs: Insight["refs"];
  command?: string;
  href?: string;
}

export function urgency(days: number | null): number {
  if (days === null) return 1;
  if (days < 0) return 3.2;
  return 1 + 2 * Math.exp(-days / 4);
}
export function effortFactor(minutes: number): number {
  return 1 + 0.5 * Math.log2(1 + minutes / 30);
}

function goalImpact(w: World, goalId: string | null): number {
  if (!goalId) return 0.3;
  const g = w.idx.goal.get(goalId);
  if (!g || g.status !== "active") return 0.25;
  return 0.2 * g.priority;
}

function candidates(w: World): Candidate[] {
  const c: Candidate[] = [];
  const now = w.now;

  // 1. Unanswered inbound messages tied to opportunities or people who matter
  for (const m of w.messages.filter((m) => m.direction === "in" && m.needsReply)) {
    if (w.messages.some((o) => o.direction === "out" && o.personId === m.personId && o.occurredAt > m.occurredAt)) continue;
    const person = m.personId ? w.idx.person.get(m.personId) : undefined;
    const opp = m.opportunityId ? w.idx.opportunity.get(m.opportunityId) : undefined;
    const fit = opp ? opportunityFit(w, opp.id) : null;
    const goalId = opp ? (linksOf(w, "opportunity", opp.id).find((l) => l.toType === "goal")?.toId ?? null) : null;
    const age = daysSince(m.occurredAt, now) ?? 0;
    c.push({
      key: `action:reply:${m.id}`,
      title: `Reply to ${person?.name ?? "message"}${opp ? ` (${opp.title.split("—").pop()?.trim()})` : ""}`,
      reason: `${person?.role ?? "Contact"} ${person?.companyId ? `at ${w.idx.company.get(person.companyId)?.name} ` : ""}contacted you ${age} day${age === 1 ? "" : "s"} ago and no response has been recorded.`,
      goalId: goalId ?? null,
      minutes: 10,
      deadlineDays: opp?.deadline ? daysUntil(opp.deadline, now) : Math.max(1, 5 - age),
      impactBonus: (fit ? fit.score * 0.4 : 0.1) + (person?.relationship === "recruiter" ? 0.15 : 0),
      confidence: 0.9,
      evidence: [
        fact(w, `${m.channel} from ${person?.name ?? "unknown"} on ${shortDate(m.occurredAt)} — needs reply`, "message", m.id),
        ...(opp ? [fact(w, `${opp.title}: deadline ${opp.deadline ? relativeDay(opp.deadline, now) : "not set"}, fit ${Math.round((fit?.score ?? 0) * 100)}%`, "opportunity", opp.id)] : []),
      ],
      assumptions: ["No reply was sent outside LIFEOS"],
      wouldChange: ["A reply sent from another channel"],
      refs: [...(person ? [{ type: "person" as const, id: person.id, label: person.name }] : []), ...(opp ? [{ type: "opportunity" as const, id: opp.id, label: opp.title }] : [])],
      command: `Draft a reply to ${person?.name ?? "this message"}`,
    });
  }

  // 2. Near-complete projects with a smallest next step
  for (const p of w.projects.filter((p) => p.status === "active" || p.status === "blocked")) {
    const prog = projectProgress(w, p.id);
    if (prog.pct < 0.55 || !prog.remaining.length) continue;
    const next = prog.remaining
      .filter((t) => t.status !== "blocked" && !(t.dependsOnTaskId && w.idx.task.get(t.dependsOnTaskId)?.status !== "done"))
      .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.estimateMinutes ?? 60) - (b.estimateMinutes ?? 60))[0];
    if (!next) continue;
    const reviewer = linksOf(w, "project", p.id).find((l) => l.relation === "reviews");
    c.push({
      key: `action:project:${p.id}`,
      title: `${next.title}`,
      reason: `“${p.title}” is ${Math.round(prog.pct * 100)}% complete with ${prog.remaining.length} task${prog.remaining.length === 1 ? "" : "s"} left (${hours(prog.remainingMinutes)})${p.goalId ? ` and directly supports “${w.idx.goal.get(p.goalId)?.title}”` : ""}.`,
      goalId: p.goalId,
      minutes: next.estimateMinutes ?? 60,
      deadlineDays: daysUntil(next.dueDate ?? p.dueDate, now),
      impactBonus: 0.15 + prog.pct * 0.2,
      confidence: 0.85,
      evidence: [
        fact(w, `${prog.doneCount}/${prog.totalCount} tasks done (${Math.round(prog.pct * 100)}% by estimated effort)`, "project", p.id),
        ...(p.dueDate ? [fact(w, `Project due ${relativeDay(p.dueDate, now)}`, "project", p.id)] : []),
        ...(reviewer ? [fact(w, `${w.idx.person.get(reviewer.fromId)?.name} is reviewing this project`, "person", reviewer.fromId)] : []),
        fact(w, `Next unblocked task: ${next.title} (${hours(next.estimateMinutes ?? 60)})`, "task", next.id),
      ],
      assumptions: ["Task estimates are roughly right", "The project deadline still holds"],
      wouldChange: [`If the deadline moves out by more than two weeks`, "If the project is deprioritised"],
      refs: [{ type: "project", id: p.id, label: p.title }, { type: "task", id: next.id, label: next.title }],
      command: `Move project "${p.title}" forward`,
    });
  }

  // 3. Strong-fit opportunities with deadlines approaching and not yet applied
  for (const o of w.opportunities.filter((o) => isOpenOpp(o) && ["identified", "researching", "preparing"].includes(o.status))) {
    const d = daysUntil(o.deadline, now);
    if (d === null || d < 0 || d > 14) continue;
    const fit = opportunityFit(w, o.id);
    if (fit.score < 0.45 && (o.effortHours ?? 1) > 0.5) continue;
    const goalId = linksOf(w, "opportunity", o.id).find((l) => l.toType === "goal")?.toId ?? null;
    const value = annualValue(o);
    c.push({
      key: `action:opp:${o.id}`,
      title: (o.effortHours ?? 1) <= 0.5 ? `${o.type === "event" ? "RSVP" : "Apply"}: ${o.title}` : `Prepare and submit: ${o.title}`,
      reason: `${fit.score >= 0.7 ? "Unusually strong" : "Reasonable"} match (${Math.round(fit.score * 100)}%) and the deadline is ${relativeDay(o.deadline, now)}.`,
      goalId,
      minutes: Math.round((o.effortHours ?? 1) * 60),
      deadlineDays: d,
      impactBonus: fit.score * 0.5 + (value ? clamp(Math.log10(value) / 25) : 0) + (fit.contacts.length ? 0.1 : 0),
      confidence: 0.8,
      evidence: [
        fact(w, `Deadline ${shortDate(o.deadline)}`, "opportunity", o.id),
        ...fit.matched.slice(0, 4).map((m) => fact(w, `${m.name}: you ${m.have}/5 vs ${m.need} needed${m.evidencedBy.length ? ` — evidenced by ${m.evidencedBy.join(", ")}` : ""}`, "opportunity", o.id)),
        ...fit.gaps.slice(0, 2).map((g) => fact(w, `Gap: ${g.name} ${g.have}/5 vs ${g.need}`, "opportunity", o.id)),
        ...(value ? [{ text: `Value ≈ ${money(value)}${o.valuePeriod === "per_year" ? "/yr" : ""} (midpoint of stated range)`, provenance: "estimate" as const }] : []),
        ...(fit.contacts.length ? [fact(w, `Warm contact: ${fit.contacts.map((x) => x.name).join(", ")}`)] : []),
      ],
      assumptions: ["Skill levels are self-assessed", "Stated deadline is accurate"],
      wouldChange: ["A visa or location constraint that rules it out", "The deadline being extended"],
      refs: [{ type: "opportunity", id: o.id, label: o.title }],
      command: `Analyze opportunity "${o.title}"`,
    });
  }

  // 4. Follow-ups on applications
  for (const a of w.applications.filter((a) => a.status === "submitted" && !a.lastFollowUpAt)) {
    const age = daysSince(a.submittedAt, now) ?? 0;
    if (age < w.settings.followUpDays) continue;
    const o = w.idx.opportunity.get(a.opportunityId);
    if (!o) continue;
    const referrer = linksOf(w, "opportunity", o.id).find((l) => l.relation === "can_refer");
    c.push({
      key: `action:followup:${a.id}`,
      title: referrer ? `Ask ${w.idx.person.get(referrer.fromId)?.name} for a referral on ${o.title.split("—").pop()?.trim()}` : `Follow up on ${o.title}`,
      reason: `Applied ${age} days ago with no follow-up recorded${referrer ? `; ${w.idx.person.get(referrer.fromId)?.name} offered to refer you` : ""}.`,
      goalId: linksOf(w, "opportunity", o.id).find((l) => l.toType === "goal")?.toId ?? null,
      minutes: 10,
      deadlineDays: null,
      impactBonus: opportunityFit(w, o.id).score * 0.25 + (referrer ? 0.15 : 0) + Math.min(0.2, age / 60),
      confidence: 0.7,
      evidence: [
        fact(w, `Application submitted ${shortDate(a.submittedAt)} (${age} days ago)`, "opportunity", o.id),
        ...(referrer ? [fact(w, `${w.idx.person.get(referrer.fromId)?.name}: ${referrer.rationale ?? "can refer"}`, "person", referrer.fromId)] : []),
      ],
      assumptions: ["Follow-ups and referrals improve response rates"],
      wouldChange: ["Employer guidance not to chase"],
      refs: [{ type: "opportunity", id: o.id, label: o.title }],
      command: `Draft a follow-up for ${o.title}`,
    });
  }

  // 5. Interviews and exams in the next 3 days → preparation
  for (const e of w.events.filter((e) => e.kind === "interview")) {
    const d = daysUntil(e.startsAt, now);
    if (d === null || d < 0 || d > 3) continue;
    const prep = w.tasks.find((t) => t.status !== "done" && e.opportunityId && w.idx.opportunity.get(e.opportunityId)?.companyId && t.title.toLowerCase().includes(w.idx.company.get(w.idx.opportunity.get(e.opportunityId)!.companyId!)!.name.split(" ")[0].toLowerCase()));
    c.push({
      key: `action:interview:${e.id}`,
      title: prep ? prep.title : `Prepare for ${e.title}`,
      reason: `${e.title} is ${relativeDay(e.startsAt, now)}${prep ? ` and preparation is ${prep.status.replace("_", " ")}` : ""}.`,
      goalId: e.opportunityId ? (linksOf(w, "opportunity", e.opportunityId).find((l) => l.toType === "goal")?.toId ?? null) : null,
      minutes: prep?.estimateMinutes ?? 90,
      deadlineDays: d,
      impactBonus: 0.6,
      confidence: 0.9,
      evidence: [
        fact(w, `${e.title} at ${e.startsAt.toISOString().slice(11, 16)} UTC ${shortDate(e.startsAt)}`, "event", e.id),
        ...(prep ? [fact(w, `Prep task: ${prep.title} (${prep.status})`, "task", prep.id)] : []),
        ...w.memories.filter((m) => m.status === "active" && /interview/i.test(m.content)).map((m) => ({ text: `Memory: ${m.content}`, provenance: "user_input" as const, ref: { type: "memory" as const, id: m.id, label: m.content.slice(0, 40) } })),
      ],
      assumptions: ["Interview time unchanged"],
      wouldChange: ["Interview rescheduled"],
      refs: [{ type: "event", id: e.id, label: e.title }, ...(prep ? [{ type: "task" as const, id: prep.id, label: prep.title }] : [])],
    });
  }

  // 6. Payment and admin deadlines found in documents
  for (const f of w.documentFields.filter((f) => (f.key === "due_date" || f.key === "notice_deadline") && f.valueType === "date")) {
    const d = daysUntil(f.value, now);
    if (d === null || d < 0 || d > 10) continue;
    const doc = w.idx.document.get(f.documentId);
    if (!doc) continue;
    const isOwnInvoice = doc.kind === "invoice" && /amogh|sole trader/i.test(w.documentFields.find((x) => x.documentId === doc.id && x.key === "vendor")?.value ?? "");
    if (isOwnInvoice) continue;
    const amount = w.documentFields.find((x) => x.documentId === doc.id && x.key === "amount")?.value;
    c.push({
      key: `action:doc:${f.id}`,
      title: f.key === "notice_deadline" ? `Decide whether to renew: ${doc.title}` : `Pay ${doc.title.split("—")[0].trim()}${amount ? ` (£${amount})` : ""}`,
      reason: `${f.label} is ${relativeDay(f.value, now)} according to the uploaded document.`,
      goalId: null,
      minutes: f.key === "notice_deadline" ? 30 : 5,
      deadlineDays: d,
      impactBonus: f.key === "notice_deadline" ? 0.45 : 0.25,
      confidence: f.confidence,
      evidence: [
        { text: `${f.label}: ${f.value}`, provenance: f.key === "notice_deadline" ? "ai_inference" : "fact", ref: { type: "document", id: doc.id, label: doc.title } },
        ...(f.sourceText ? [{ text: `“${f.sourceText.slice(0, 150)}”`, provenance: "fact" as const, ref: { type: "document" as const, id: doc.id, label: doc.title } }] : []),
      ],
      assumptions: [f.key === "notice_deadline" ? "Notice deadline = fixed-term end minus notice period" : "Invoice not yet paid"],
      wouldChange: ["Already paid / already decided"],
      refs: [{ type: "document", id: doc.id, label: doc.title }],
      href: `/documents/${doc.id}`,
    });
  }

  // 7. Overdue commitments
  for (const cm of w.commitments.filter((x) => x.status === "open")) {
    const d = daysUntil(cm.dueDate, now);
    if (d === null || d > 1) continue;
    c.push({
      key: `action:commitment:${cm.id}`,
      title: cm.title,
      reason: d < 0 ? `You promised this ${-d} days ago.` : `Due ${relativeDay(cm.dueDate, now)}.`,
      goalId: null,
      minutes: 10,
      deadlineDays: Math.max(d, 0),
      impactBonus: 0.15,
      confidence: 0.75,
      evidence: [userInput(w, `Commitment due ${shortDate(cm.dueDate)}`, "commitment", cm.id)],
      assumptions: ["Not already done"],
      wouldChange: ["Already completed"],
      refs: [{ type: "commitment", id: cm.id, label: cm.title }],
    });
  }

  // 8. Cheap unblocks
  for (const t of w.tasks.filter((t) => t.status === "todo" && (t.estimateMinutes ?? 99) <= 30)) {
    const unblocks = w.tasks.filter((x) => x.dependsOnTaskId === t.id && x.status !== "done");
    if (!unblocks.length) continue;
    const project = t.projectId ? w.idx.project.get(t.projectId) : undefined;
    c.push({
      key: `action:unblock:${t.id}`,
      title: t.title,
      reason: `A ${t.estimateMinutes}-minute task that unblocks ${unblocks.map((u) => `“${u.title}”`).join(", ")}${project ? ` in ${project.title}` : ""}.`,
      goalId: t.goalId,
      minutes: t.estimateMinutes ?? 20,
      deadlineDays: null,
      impactBonus: 0.25 * unblocks.length,
      confidence: 0.85,
      evidence: [fact(w, `Blocks: ${unblocks.map((u) => u.title).join("; ")}`, "task", t.id)],
      assumptions: ["Dependency is accurate"],
      wouldChange: ["Blocked work no longer needed"],
      refs: [{ type: "task", id: t.id, label: t.title }],
    });
  }

  return c;
}

export function rankActions(w: World): Insight[] {
  return candidates(w)
    .map((cand) => {
      const impact = goalImpact(w, cand.goalId) + cand.impactBonus;
      const urg = urgency(cand.deadlineDays);
      const eff = effortFactor(cand.minutes);
      const score = (impact * urg * cand.confidence) / eff;
      return insight({
        key: cand.key,
        kind: "action",
        title: cand.title,
        conclusion: cand.reason,
        evidence: cand.evidence,
        assumptions: cand.assumptions,
        wouldChange: cand.wouldChange,
        confidenceScore: cand.confidence,
        score: Number(score.toFixed(3)),
        scoreBreakdown: [
          { factor: "Impact", value: Number(impact.toFixed(2)), note: cand.goalId ? `Goal “${w.idx.goal.get(cand.goalId)?.title}” priority ${w.idx.goal.get(cand.goalId)?.priority}/5 + value/fit bonus` : "Not tied to a goal; value/fit bonus only" },
          { factor: "Urgency", value: Number(urg.toFixed(2)), note: cand.deadlineDays === null ? "No deadline" : cand.deadlineDays < 0 ? "Overdue" : `Deadline in ${cand.deadlineDays} day(s)` },
          { factor: "Confidence", value: cand.confidence, note: "Completeness of the underlying data" },
          { factor: "Effort", value: Number(eff.toFixed(2)), note: `~${hours(cand.minutes)}` },
        ],
        severity: cand.deadlineDays !== null && cand.deadlineDays <= 1 ? "critical" : score > 1 ? "important" : "watch",
        refs: cand.refs,
        actions: [{ label: "Do it", command: cand.command, href: cand.href, minutes: cand.minutes }],
      });
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
