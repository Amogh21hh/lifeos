import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { analyzeDecision } from "@/server/engine/decision";
import { Badge } from "@/components/ui/primitives";
import { DecisionWorkspace } from "./workspace";

export const metadata: Metadata = { title: "Decision" };

export default async function DecisionPage(props: PageProps<"/decisions/[id]">) {
  const { id } = await props.params;
  const w = await getWorld();
  const decision = w.idx.decision.get(id);
  if (!decision) notFound();
  const options = w.decisionOptions.filter((o) => o.decisionId === id).sort((a, b) => a.position - b.position);
  const criteria = w.decisionCriteria.filter((c) => c.decisionId === id);
  const scores = w.decisionScores.filter((s) => options.some((o) => o.id === s.optionId));
  const analysis = analyzeDecision(w, { decision, options, criteria, scores });
  const goals = Object.fromEntries(criteria.filter((c) => c.linkedGoalId).map((c) => [c.id, w.idx.goal.get(c.linkedGoalId!)?.title ?? ""]));
  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/decisions" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Decisions
      </Link>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{decision.domain}</Badge>
          <Badge tone={decision.stakes === "high" ? "danger" : decision.stakes === "medium" ? "signal" : "neutral"}>{decision.stakes} stakes</Badge>
          <Badge>{decision.reversibility}</Badge>
          <Badge tone={decision.status === "decided" ? "success" : "accent"}>{decision.status}</Badge>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{decision.title}</h1>
        {decision.question !== decision.title && <p className="mt-1 text-sm text-muted">{decision.question}</p>}
        {decision.context && <p className="mt-2 max-w-3xl text-sm whitespace-pre-line text-muted">{decision.context}</p>}
      </div>
      <DecisionWorkspace
        decision={{ id: decision.id, status: decision.status, chosenOptionId: decision.chosenOptionId, outcome: decision.outcome, lessons: decision.lessons, reviewOn: decision.reviewOn, model: decision.model }}
        options={options.map((o) => ({ id: o.id, label: o.label, upfrontCost: o.upfrontCost, monthlyCost: o.monthlyCost, timeHours: o.timeHours }))}
        criteria={criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, rationale: c.rationale, goal: goals[c.id] ?? null }))}
        scores={scores.map((s) => ({ optionId: s.optionId, criterionId: s.criterionId, score: s.score, low: s.low, high: s.high, rationale: s.rationale, provenance: s.provenance }))}
        analysis={analysis}
      />
    </div>
  );
}
