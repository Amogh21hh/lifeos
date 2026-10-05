import type { Metadata } from "next";
import Link from "next/link";
import { Scale } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { relativeDay, shortDate } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { NewDecision } from "./new-decision";

export const metadata: Metadata = { title: "Decisions" };

export default async function DecisionsPage() {
  const w = await getWorld();
  const open = w.decisions.filter((d) => d.status !== "decided").sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  const decided = w.decisions.filter((d) => d.status === "decided").sort((a, b) => (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0));
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="Decision engine" title="Decisions" description="Turn a question into a transparent model: options, weighted criteria, scenarios, sensitivity and the unknowns that would change the answer. LIFEOS never chooses for you." />
      <Card className="mb-8">
        <CardHeader title="Frame a new decision" icon={<Scale className="text-p-ai" />} />
        <div className="px-5 pb-5">
          <NewDecision />
        </div>
      </Card>
      {w.decisions.length === 0 ? (
        <EmptyState icon={<Scale />} title="No decisions yet" body="Ask something like “Should I spend £500 on this course?”" />
      ) : (
        <div className="space-y-8">
          {[
            { title: "Open", items: open },
            { title: "Decided", items: decided },
          ].map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                {g.title} <span className="font-mono text-faint">({g.items.length})</span>
              </h2>
              <div className="space-y-2">
                {g.items.map((d) => {
                  const chosen = d.chosenOptionId ? w.decisionOptions.find((o) => o.id === d.chosenOptionId) : undefined;
                  const reviewDue = d.reviewOn && d.reviewOn <= w.now.toISOString().slice(0, 10);
                  return (
                    <Link key={d.id} href={`/decisions/${d.id}`} className="flex flex-col gap-2 rounded-xl border border-line bg-elev px-4 py-3 transition-colors hover:border-line-strong sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-fg">{d.title}</div>
                        <div className="mt-0.5 truncate text-xs text-muted">{chosen ? `Chose: ${chosen.label}` : d.question}</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge>{d.domain}</Badge>
                        <Badge tone={d.stakes === "high" ? "danger" : d.stakes === "medium" ? "signal" : "neutral"}>{d.stakes} stakes</Badge>
                        <Badge>{d.reversibility}</Badge>
                        {d.deadline && d.status !== "decided" && <Badge tone="signal">decide {relativeDay(d.deadline, w.now)}</Badge>}
                        {d.decidedAt && <Badge tone="success">decided {shortDate(d.decidedAt)}</Badge>}
                        {reviewDue && <Badge tone="warning">review due</Badge>}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
