/**
 * "What happens if…" simulator.
 *
 * Every simulation is a deterministic model with *named, editable assumptions*. The UI renders the
 * assumptions as sliders; changing one re-runs the model. Outputs are labelled ESTIMATE — they are
 * projections from your own data and stated assumptions, never predictions.
 */
import { clamp, daysUntil, hours, money, shortDate } from "@/lib/format";
import type { SimulationAssumption, SimulationResult } from "@/lib/types";
import { cosine, localEmbed } from "@/server/ai/embeddings";
import { annualValue, financeSummary, goalProgress, isOpenOpp, opportunityFit, projectProgress } from "./signals";
import { linksOf, type World } from "./world";

type Overrides = Record<string, number>;

function bestMatch<T>(items: T[], text: (t: T) => string, query: string): T | undefined {
  const q = query.toLowerCase();
  const direct = items.find((i) => q.includes(text(i).toLowerCase()) || text(i).toLowerCase().split(/\s+/).filter((x) => x.length > 3).some((word) => q.includes(word)));
  if (direct) return direct;
  const qv = localEmbed(query);
  return [...items].sort((a, b) => cosine(qv, localEmbed(text(b))) - cosine(qv, localEmbed(text(a))))[0];
}

function A(key: string, label: string, value: number, unit: string, provenance: SimulationAssumption["provenance"], min?: number, max?: number, step?: number): SimulationAssumption {
  return { key, label, value, unit, provenance, min, max, step };
}

function val(assumptions: SimulationAssumption[], ov: Overrides, key: string) {
  const a = assumptions.find((x) => x.key === key)!;
  if (ov[key] !== undefined && Number.isFinite(ov[key])) a.value = ov[key];
  return a.value;
}

/** Weekly minutes actually spent per project over the last 14 days. */
function weeklyRate(w: World, projectId: string, windowDays = 14) {
  const since = w.now.getTime() - windowDays * 86_400_000;
  const taskIds = new Set((w.idx.tasksByProject.get(projectId) ?? []).map((t) => t.id));
  let min = 0;
  for (const a of w.activities) {
    if (!a.minutesSpent || a.occurredAt.getTime() < since) continue;
    if ((a.entityType === "project" && a.entityId === projectId) || (a.entityType === "task" && a.entityId && taskIds.has(a.entityId))) min += a.minutesSpent;
  }
  return min / (windowDays / 7);
}

export function classifyScenario(q: string): SimulationResult["scenarioType"] {
  if (/\b(stop|drop|quit|abandon|pause|cancel)\b.*\b(project|training|goal|course|marathon|half)/i.test(q) || /\bstop (working on )?\w/i.test(q)) return "stop_project";
  if (/\b(delay|postpone|push back|move)\b.*\b(deadline|by|until|week|day)/i.test(q)) return "delay_deadline";
  if (/\b(learn|master|get better at|improve|study)\b/i.test(q)) return "learn_skill";
  if (/\b(\d+)\s*(extra|more|additional)?\s*hours?\b/i.test(q) || /\bextra hours\b/i.test(q)) return "extra_hours";
  if (/\b(spend|buy|pay|purchase|cost)\b/i.test(q) || /£\s?\d/.test(q)) return /\b(earn|income|raise|get paid|retainer)\b/i.test(q) ? "income_change" : "spend";
  if (/\b(earn|income|raise|retainer|salary)\b/i.test(q)) return "income_change";
  return "unknown";
}

export function simulate(w: World, question: string, ov: Overrides = {}): SimulationResult {
  const type = classifyScenario(question);
  switch (type) {
    case "extra_hours":
      return simExtraHours(w, question, ov);
    case "stop_project":
      return simStopProject(w, question, ov);
    case "spend":
      return simSpend(w, question, ov, -1);
    case "income_change":
      return simSpend(w, question, ov, 1);
    case "delay_deadline":
      return simDelay(w, question, ov);
    case "learn_skill":
      return simLearn(w, question, ov);
    default:
      return {
        question,
        scenarioType: "unknown",
        headline: "I couldn't map that to a scenario I can model transparently.",
        assumptions: [],
        effects: [],
        risks: [],
        secondOrder: [],
        caveats: ["Supported scenarios: extra hours, stopping a project, spending or earning money, delaying a deadline, learning a skill.", "Try: “What happens if I work 10 extra hours this month?”"],
        confidence: "low",
      };
  }
}

function simExtraHours(w: World, q: string, ov: Overrides): SimulationResult {
  const m = q.match(/(\d+(?:\.\d+)?)\s*(?:extra|more|additional)?\s*hours?/i);
  const perMonth = /month/i.test(q);
  const assumptions = [
    A("hours", `Extra hours per ${perMonth ? "month" : "week"}`, m ? Number(m[1]) : 10, "h", "user_input", 1, perMonth ? 80 : 30, 1),
    A("topShare", "Share of extra time given to your top-priority goal", 70, "%", "assumption", 0, 100, 5),
    A("efficiency", "Efficiency of extra hours (fatigue)", 80, "%", "assumption", 30, 100, 5),
  ];
  const extraPerWeekMin = (val(assumptions, ov, "hours") * 60) / (perMonth ? 4.33 : 1);
  const topShare = val(assumptions, ov, "topShare") / 100;
  const eff = val(assumptions, ov, "efficiency") / 100;

  const topGoal = [...w.goals].filter((g) => g.status === "active").sort((a, b) => b.priority - a.priority)[0];
  const active = w.projects.filter((p) => p.status === "active" || p.status === "blocked");
  const topProjects = active.filter((p) => p.goalId === topGoal?.id || (topGoal && w.idx.goal.get(p.goalId ?? "")?.priority === topGoal.priority));
  const others = active.filter((p) => !topProjects.includes(p));
  const effects: SimulationResult["effects"] = [];
  const timeline: SimulationResult["timeline"] = [];
  const share = (p: World["projects"][number]) => (topProjects.includes(p) ? topShare / Math.max(1, topProjects.length) : (1 - topShare) / Math.max(1, others.length));

  for (const p of [...topProjects, ...others].slice(0, 6)) {
    const prog = projectProgress(w, p.id);
    if (!prog.remainingMinutes) continue;
    const base = Math.max(15, weeklyRate(w, p.id));
    const scen = base + extraPerWeekMin * share(p) * eff;
    const baseWeeks = prog.remainingMinutes / base;
    const scenWeeks = prog.remainingMinutes / scen;
    const fmtWeeks = (x: number) => (x > 52 ? "> 1 year" : x < 1 ? `${Math.max(1, Math.round(x * 7))} days` : `${x.toFixed(1)} weeks`);
    effects.push({
      label: `${p.title} — time to finish`,
      before: fmtWeeks(baseWeeks),
      after: fmtWeeks(scenWeeks),
      delta: `${(baseWeeks - scenWeeks).toFixed(1)} weeks sooner`,
      provenance: "estimate",
      direction: scenWeeks < baseWeeks ? "up" : "flat",
    });
  }
  // Timeline: cumulative completion of top-goal projects over 8 weeks
  const remTop = topProjects.reduce((a, p) => a + projectProgress(w, p.id).remainingMinutes, 0);
  const baseRateTop = topProjects.reduce((a, p) => a + Math.max(15, weeklyRate(w, p.id)), 0);
  const scenRateTop = baseRateTop + extraPerWeekMin * topShare * eff;
  for (let wk = 0; wk <= 8; wk++)
    timeline.push({ label: `W${wk}`, base: remTop ? Math.round(clamp((baseRateTop * wk) / remTop) * 100) : 100, scenario: remTop ? Math.round(clamp((scenRateTop * wk) / remTop) * 100) : 100 });

  const capacity = w.settings.focusHoursPerWeek;
  const extraWeekly = extraPerWeekMin / 60;
  return {
    question: q,
    scenarioType: "extra_hours",
    headline: `${hours(extraPerWeekMin)}/week extra, ${Math.round(topShare * 100)}% aimed at “${topGoal?.title ?? "your top goal"}”, finishes its remaining work ${remTop ? `${((remTop / baseRateTop - remTop / scenRateTop)).toFixed(1)} weeks sooner` : "— nothing left to finish"}.`,
    assumptions,
    effects: [
      ...effects,
      { label: "Weekly workload", before: `${capacity} h`, after: `${(capacity + extraWeekly).toFixed(1)} h`, delta: `+${Math.round((extraWeekly / capacity) * 100)}%`, provenance: "estimate", direction: "down" },
    ],
    timeline,
    timelineUnit: "% of top-goal project work completed",
    risks: [extraWeekly / capacity > 0.3 ? "More than 30% above your stated focus capacity — sustained over a month, quality and sleep usually suffer." : "Moderate increase; watch for crowding out recovery time."],
    secondOrder: [
      ...w.events.filter((e) => e.kind === "exam" && (daysUntil(e.startsAt, w.now) ?? 999) < 90).map((e) => `${e.title} ${shortDate(e.startsAt)}: extra hours elsewhere compete with exam prep.`),
      "Finishing portfolio work sooner improves the evidence available for live applications.",
    ],
    caveats: ["Base pace = actual logged time per project over the last 14 days (minimum 15 min/week).", "Remaining work = sum of open task estimates."],
    confidence: "medium",
  };
}

function simStopProject(w: World, q: string, ov: Overrides): SimulationResult {
  const candidates = [...w.projects.filter((p) => p.status !== "done"), ...[]];
  const p = bestMatch(candidates, (x) => x.title, q);
  if (!p) return simulate(w, "unknown", ov);
  const assumptions = [A("reallocate", "Share of freed time reallocated to top goal", 60, "%", "assumption", 0, 100, 5)];
  const realloc = val(assumptions, ov, "reallocate") / 100;
  const prog = projectProgress(w, p.id);
  // Use a longer window for stopping decisions, and fall back to planned habit time if nothing was logged.
  const habit = w.habits.find((h) => h.goalId === p.goalId && h.active);
  const plannedFromHabit = habit ? (habit.cadence === "weekly" ? habit.targetPerPeriod : habit.targetPerPeriod * 7) * 45 : 0;
  const logged = weeklyRate(w, p.id, 42);
  const rate = Math.max(logged, logged < 15 ? plannedFromHabit : 0);
  const goal = p.goalId ? w.idx.goal.get(p.goalId) : undefined;
  const siblings = goal ? w.projects.filter((x) => x.goalId === goal.id && x.id !== p.id && x.status !== "done") : [];
  const linked = linksOf(w, "project", p.id);
  const dependentOpps = linked.filter((l) => l.fromType === "opportunity" || l.toType === "opportunity").map((l) => w.idx.opportunity.get(l.fromType === "opportunity" ? l.fromId : l.toId)).filter(Boolean);
  const people = linked.filter((l) => l.fromType === "person").map((l) => w.idx.person.get(l.fromId)?.name).filter(Boolean);
  const skillsLost = linked.filter((l) => l.relation === "evidences").map((l) => w.idx.skill.get(l.toId)?.name).filter(Boolean);
  const fin = financeSummary(w);
  const subscription = /train|marathon|run|gym/i.test(p.title) ? fin.recurring.find((r) => r.category === "Fitness") : undefined;
  const topGoal = [...w.goals].filter((g) => g.status === "active").sort((a, b) => b.priority - a.priority)[0];

  return {
    question: q,
    scenarioType: "stop_project",
    headline: `Stopping “${p.title}” frees ~${hours(rate)}/week${prog.remainingMinutes ? ` and ${hours(prog.remainingMinutes)} of planned work` : ""}; ${goal ? `“${goal.title}” would ${siblings.length ? `rely on ${siblings.length} other project(s)` : "have no active project"}` : "no goal depends on it"}.`,
    assumptions,
    effects: [
      { label: "Time freed per week", before: "0 h", after: hours(rate), delta: `+${hours(rate)}`, provenance: "estimate", direction: "up" },
      { label: `Extra time on “${topGoal?.title ?? "top goal"}”`, before: "—", after: `${hours(rate * realloc)}/week`, delta: `+${hours(rate * realloc)}`, provenance: "assumption", direction: "up" },
      ...(goal ? [{ label: `Goal “${goal.title}”`, before: `${siblings.length + 1} active projects`, after: `${siblings.length} active projects`, delta: siblings.length ? "reduced coverage" : "no path forward", provenance: "fact" as const, direction: "down" as const }] : []),
      { label: "Sunk work", before: `${Math.round(prog.pct * 100)}% complete`, after: "parked", delta: `${prog.doneCount} finished tasks unused`, provenance: "fact", direction: "down" },
      ...(subscription ? [{ label: subscription.description, before: money(subscription.monthly) + "/mo", after: "could be paused", delta: `+${money(subscription.monthly * 12)}/yr`, provenance: "estimate" as const, direction: "up" as const }] : []),
    ],
    risks: [
      ...dependentOpps.map((o) => `“${o!.title}” is linked to this project and loses its supporting work.`),
      ...(skillsLost.length ? [`Loses evidence for: ${skillsLost.join(", ")}.`] : []),
      ...(people.length ? [`${people.join(", ")} ${people.length > 1 ? "are" : "is"} involved — tell them.`] : []),
    ],
    secondOrder: [goal && !siblings.length ? `Consider pausing the goal “${goal.title}” explicitly rather than leaving it silently stalled.` : "Remaining projects absorb the goal.", "Stopping is reversible: archive the project with notes so restarting is cheap."],
    caveats: [logged >= 15 ? "Freed time = actual logged time on this project over the last 6 weeks." : plannedFromHabit ? `Little time was logged recently, so freed time uses the planned habit (${habit?.title}: ${habit?.targetPerPeriod}×/${habit?.cadence === "weekly" ? "week" : "day"} × 45 min) — an ASSUMPTION.` : "No time logged recently — stopping frees little time; the main effect is on goals and dependencies."],
    confidence: "medium",
  };
}

function simSpend(w: World, q: string, ov: Overrides, sign: 1 | -1): SimulationResult {
  const amt = q.match(/£\s?([\d,]+(?:\.\d+)?)(k)?/i);
  const parsed = amt ? parseFloat(amt[1].replace(/,/g, "")) * (amt[2] ? 1000 : 1) : sign < 0 ? 300 : 200;
  const recurring = /\b(per|a|every)\s*(month|mo)\b|monthly|retainer/i.test(q);
  const fin = financeSummary(w);
  const assumptions = [
    A("amount", sign < 0 ? (recurring ? "Monthly cost" : "One-off spend") : recurring ? "Extra monthly income" : "One-off income", parsed, "£", "user_input", 0, Math.max(parsed * 4, 1000), 10),
    A("savingsRate", "Current monthly net (income − spending)", Math.round(fin.monthlyNet), "£", "estimate", -2000, 2000, 10),
    A("essentials", "Essential monthly costs", Math.round(fin.monthlyEssentials), "£", "estimate", 300, 4000, 10),
  ];
  const amount = val(assumptions, ov, "amount");
  const saving = val(assumptions, ov, "savingsRate");
  const essentials = val(assumptions, ov, "essentials");
  const fund = w.goals.find((g) => g.category === "finance" && /emergency|fund|sav/i.test(g.title));
  const budget = w.goals.find((g) => /spend/i.test(g.title));
  const delta = sign * amount;
  const liquidAfter = fin.liquid + (recurring ? 0 : delta);
  const savingAfter = saving + (recurring ? delta : 0);
  const runwayBefore = fin.liquid / essentials;
  const runwayAfter = liquidAfter / (essentials + (recurring && sign < 0 ? amount : 0));
  const timeline: SimulationResult["timeline"] = [];
  for (let m = 0; m <= 12; m++) timeline.push({ label: `M${m}`, base: Math.round(fin.liquid + saving * m), scenario: Math.round(liquidAfter + savingAfter * m) });

  const fundEffect = (() => {
    if (!fund || fund.targetValue === null) return null;
    const gap = fund.targetValue - (fund.currentValue ?? 0);
    const monthsBase = saving > 0 ? gap / saving : Infinity;
    const gapAfter = gap - (recurring ? 0 : delta);
    const monthsAfter = savingAfter > 0 ? gapAfter / savingAfter : Infinity;
    const fmt = (x: number) => (Number.isFinite(x) ? `${Math.max(0, x).toFixed(1)} months` : "never at this rate");
    return { label: `Time to “${fund.title}”`, before: fmt(monthsBase), after: fmt(monthsAfter), delta: Number.isFinite(monthsAfter - monthsBase) ? `${(monthsAfter - monthsBase > 0 ? "+" : "")}${(monthsAfter - monthsBase).toFixed(1)} months` : "—", provenance: "estimate" as const, direction: (monthsAfter > monthsBase ? "down" : "up") as "up" | "down" };
  })();

  return {
    question: q,
    scenarioType: sign < 0 ? "spend" : "income_change",
    headline:
      sign < 0
        ? `${recurring ? `${money(amount)}/month` : money(amount)} ${recurring ? "adds a fixed cost" : "comes out of liquid cash"}: runway moves from ${runwayBefore.toFixed(1)} to ${runwayAfter.toFixed(1)} months.`
        : `${recurring ? `${money(amount)}/month` : money(amount)} extra income: runway ${runwayBefore.toFixed(1)} → ${runwayAfter.toFixed(1)} months.`,
    assumptions,
    effects: [
      { label: "Liquid cash", before: money(fin.liquid), after: money(liquidAfter), delta: money(liquidAfter - fin.liquid, "GBP", { sign: true }), provenance: "estimate", direction: liquidAfter >= fin.liquid ? "up" : "down" },
      { label: "Runway (essentials only)", before: `${runwayBefore.toFixed(1)} months`, after: `${runwayAfter.toFixed(1)} months`, delta: `${(runwayAfter - runwayBefore).toFixed(1)} months`, provenance: "estimate", direction: runwayAfter >= runwayBefore ? "up" : "down" },
      { label: "Monthly saving", before: money(saving), after: money(savingAfter), delta: money(savingAfter - saving, "GBP", { sign: true }), provenance: "estimate", direction: savingAfter >= saving ? "up" : "down" },
      ...(fundEffect ? [fundEffect] : []),
      ...(budget && recurring && sign < 0 && budget.targetValue ? [{ label: `Budget “${budget.title}”`, before: money(fin.monthlyExpenses), after: money(fin.monthlyExpenses + amount), delta: fin.monthlyExpenses + amount > budget.targetValue ? "over target" : "within target", provenance: "estimate" as const, direction: "down" as const }] : []),
    ],
    timeline,
    timelineUnit: "£ liquid cash (projection)",
    risks: sign < 0 && runwayAfter < 3 ? ["Runway drops below 3 months — a common minimum safety buffer while income is irregular."] : [],
    secondOrder: sign < 0 ? ["Lower runway shortens how long you can be selective in the job search.", "Check whether the purchase is reversible (refund/resale)."] : ["Extra income could fund learning (courses) without touching the emergency fund."],
    caveats: [`Based on ${fin.monthsObserved} months of transactions.`, "Savings rate = average income − average expenses (transfers excluded)."],
    confidence: fin.monthsObserved >= 3 ? "medium" : "low",
  };
}

function simDelay(w: World, q: string, ov: Overrides): SimulationResult {
  const daysMatch = q.match(/(\d+)\s*(day|week)/i);
  const assumptions = [A("delay", "Delay", daysMatch ? Number(daysMatch[1]) * (/week/i.test(daysMatch[2]) ? 7 : 1) : 7, "days", "user_input", 1, 60, 1)];
  const delay = val(assumptions, ov, "delay");
  type Item = { kind: "task" | "project" | "opportunity"; id: string; title: string; date: string | null };
  const items: Item[] = [
    ...w.tasks.filter((t) => t.status !== "done" && t.dueDate).map((t) => ({ kind: "task" as const, id: t.id, title: t.title, date: t.dueDate })),
    ...w.projects.filter((p) => p.status !== "done" && p.dueDate).map((p) => ({ kind: "project" as const, id: p.id, title: p.title, date: p.dueDate })),
    ...w.opportunities.filter((o) => isOpenOpp(o) && o.deadline).map((o) => ({ kind: "opportunity" as const, id: o.id, title: o.title, date: o.deadline })),
  ];
  const target = bestMatch(items, (i) => i.title, q);
  if (!target) return simulate(w, "unknown");
  const newDate = new Date(new Date(`${target.date}T00:00:00Z`).getTime() + delay * 86_400_000).toISOString().slice(0, 10);
  const downstream = target.kind === "task" ? w.tasks.filter((t) => t.dependsOnTaskId === target.id && t.status !== "done") : target.kind === "project" ? (w.idx.tasksByProject.get(target.id) ?? []).filter((t) => t.status !== "done" && t.dueDate && t.dueDate > newDate) : [];
  const events = w.events.filter((e) => {
    const d = e.startsAt.toISOString().slice(0, 10);
    return d >= (target.date ?? "") && d <= newDate && (e.projectId === target.id || e.opportunityId === target.id || (target.kind === "task" && e.projectId === w.idx.task.get(target.id)?.projectId));
  });
  const external = target.kind === "opportunity";
  return {
    question: q,
    scenarioType: "delay_deadline",
    headline: external ? `“${target.title}” has an external deadline — delaying means missing it unless the organiser agrees.` : `Moving “${target.title}” to ${shortDate(newDate)} affects ${downstream.length} dependent task(s) and ${events.length} event(s).`,
    assumptions,
    effects: [
      { label: target.title, before: shortDate(target.date), after: shortDate(newDate), delta: `+${delay} days`, provenance: external ? "fact" : "user_input", direction: "down" },
      ...downstream.map((t) => ({ label: `Dependent: ${t.title}`, before: shortDate(t.dueDate), after: t.dueDate ? shortDate(new Date(new Date(`${t.dueDate}T00:00:00Z`).getTime() + delay * 86_400_000)) : "slips", delta: `+${delay} days`, provenance: "estimate" as const, direction: "down" as const })),
    ],
    risks: [
      ...events.map((e) => `${e.title} (${shortDate(e.startsAt)}) falls inside the delay window.`),
      ...(external ? ["External deadlines don't move just because your plan does."] : []),
    ],
    secondOrder: ["Delays compound when the delayed item is on the critical path of another goal.", "A delay you choose explicitly beats one that happens by default — record why."],
    caveats: ["Dependencies are taken from task links; unrecorded dependencies won't appear."],
    confidence: "medium",
  };
}

function simLearn(w: World, q: string, ov: Overrides): SimulationResult {
  const skill = bestMatch(w.skills, (k) => k.name, q);
  if (!skill) return simulate(w, "unknown");
  const course = w.courses.find((c) => c.skillId === skill.id && c.status !== "completed");
  const assumptions = [
    A("levels", `Levels gained in ${skill.name}`, Math.min(2, 5 - skill.level), "levels", "assumption", 1, Math.max(1, 5 - skill.level), 1),
    A("hoursPerLevel", "Study hours per level", 15, "h", "assumption", 5, 60, 1),
    A("weekly", "Hours per week you can give it", 4, "h", "user_input", 1, 20, 1),
  ];
  const levels = val(assumptions, ov, "levels");
  const hpl = val(assumptions, ov, "hoursPerLevel");
  const weekly = val(assumptions, ov, "weekly");
  const totalHours = Math.max(0, levels * hpl - (course?.hoursDone ?? 0) * 0.3);
  const weeks = totalHours / weekly;
  const newLevel = Math.min(5, skill.level + levels);
  const affected = w.opportunities.filter((o) => isOpenOpp(o) && w.opportunitySkills.some((r) => r.opportunityId === o.id && r.skillId === skill.id));
  const effects: SimulationResult["effects"] = [{ label: `${skill.name} level`, before: `${skill.level}/5`, after: `${newLevel}/5`, delta: `+${levels}`, provenance: "assumption", direction: "up" }];
  const unlocked: string[] = [];
  for (const o of affected) {
    const before = opportunityFit(w, o.id);
    const patched = { ...w, skills: w.skills.map((k) => (k.id === skill.id ? { ...k, level: newLevel } : k)) };
    patched.idx = { ...w.idx, skill: new Map(patched.skills.map((k) => [k.id, k])) };
    const after = opportunityFit(patched, o.id);
    const req = w.opportunitySkills.find((r) => r.opportunityId === o.id && r.skillId === skill.id)!;
    if (skill.level < req.requiredLevel && newLevel >= req.requiredLevel) unlocked.push(o.title);
    effects.push({ label: `Fit: ${o.title}`, before: `${Math.round(before.score * 100)}%`, after: `${Math.round(after.score * 100)}%`, delta: `+${Math.round((after.score - before.score) * 100)} pts`, provenance: "estimate", direction: after.score > before.score ? "up" : "flat" });
  }
  const valueUnlocked = unlocked.map((t) => annualValue(w.opportunities.find((o) => o.title === t)!)).filter((v): v is number => v !== null);
  const timeline: SimulationResult["timeline"] = [];
  for (let wk = 0; wk <= Math.min(16, Math.ceil(weeks) + 2); wk++) timeline.push({ label: `W${wk}`, base: skill.level, scenario: Number(Math.min(newLevel, skill.level + (wk * weekly) / hpl).toFixed(2)) });
  const goal = w.goals.find((g) => g.status === "active" && g.title.toLowerCase().includes(skill.name.toLowerCase()));
  return {
    question: q,
    scenarioType: "learn_skill",
    headline: `Reaching ${skill.name} ${newLevel}/5 takes ~${Math.round(totalHours)}h (${weeks.toFixed(1)} weeks at ${weekly}h/week) and ${unlocked.length ? `closes the gap on ${unlocked.length} opportunit${unlocked.length === 1 ? "y" : "ies"}` : `raises fit on ${affected.length} opportunities`}.`,
    assumptions,
    effects: [...effects, ...(goal ? [{ label: `Goal “${goal.title}”`, before: `${Math.round((goalProgress(goal) ?? 0) * 100)}%`, after: "achieved", delta: "", provenance: "estimate" as const, direction: "up" as const }] : [])],
    timeline,
    timelineUnit: `${skill.name} level`,
    risks: weeks > 8 ? ["Longer than two months — consider a smaller, evidence-producing project instead of a full course."] : [],
    secondOrder: [
      ...(unlocked.length ? [`Unlocked: ${unlocked.join(", ")}${valueUnlocked.length ? ` (role midpoints ${valueUnlocked.map((v) => money(v)).join(", ")}/yr — ESTIMATE)` : ""}.`] : []),
      ...(course ? [`Fastest path: continue “${course.title}” (${course.hoursDone}/${course.hoursTotal}h done).`] : []),
      "Skill level only counts if you can show evidence — pair study with a small public project.",
    ],
    caveats: ["Fit recalculated with the same rules used across LIFEOS (skill coverage, evidence, contacts, visa)."],
    confidence: "medium",
  };
}
