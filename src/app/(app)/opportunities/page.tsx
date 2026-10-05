import type { Metadata } from "next";
import Link from "next/link";
import { Briefcase, Radar } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { opportunityFit } from "@/server/engine/signals";
import { money, relativeDay, daysUntil } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { AgentRunner } from "@/components/lifeos/agent-runner";
import { CreateEntityDialog } from "@/components/lifeos/controls";

export const metadata: Metadata = { title: "Opportunities" };

const STAGES: { key: string; label: string; statuses: string[] }[] = [
  { key: "discover", label: "Discovered", statuses: ["identified", "researching"] },
  { key: "prepare", label: "Preparing", statuses: ["preparing"] },
  { key: "live", label: "In play", statuses: ["applied", "interviewing", "offer"] },
  { key: "closed", label: "Closed", statuses: ["won", "lost", "dismissed"] },
];

export default async function OpportunitiesPage() {
  const w = await getWorld();
  const opps = w.opportunities.map((o) => ({ o, fit: opportunityFit(w, o.id), company: o.companyId ? w.idx.company.get(o.companyId)?.name : undefined }));
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        eyebrow="Opportunity radar"
        title="Opportunities"
        description="Every route you're tracking, with fit computed from your skills, evidence, contacts and constraints. Use the radar to map routes towards an objective."
        actions={
          <CreateEntityDialog
            type="opportunity"
            title="New opportunity"
            fields={[
              { name: "title", label: "Title", required: true, placeholder: "e.g. Credit Analyst — Acme Bank" },
              { name: "type", label: "Type", type: "select", required: true, options: ["job", "internship", "freelance", "side_income", "course", "scholarship", "event", "networking", "investment", "grant"].map((v) => ({ value: v, label: v.replace("_", " ") })) },
              { name: "deadline", label: "Deadline", type: "date" },
              { name: "valueLow", label: "Value (low, £)", type: "number" },
              { name: "valueHigh", label: "Value (high, £)", type: "number" },
              { name: "valuePeriod", label: "Value period", type: "select", options: ["per_year", "per_month", "per_day", "one_off"].map((v) => ({ value: v, label: v.replace("_", " ") })) },
              { name: "effortHours", label: "Effort (hours)", type: "number" },
              { name: "description", label: "Description", type: "textarea" },
            ]}
          />
        }
      />

      <Card className="mb-8">
        <CardHeader title="Opportunity radar" icon={<Radar className="text-accent" />} subtitle="State an objective. Routes are ranked by relevance × fit; upside is labelled FACT, ESTIMATE or ASSUMPTION and success rates are explicit assumptions, not predictions." />
        <div className="px-5 pb-5">
          <AgentRunner agent="OpportunityAgent" input={{ op: "radar" }} promptKey="objective" label="Scan" promptPlaceholder="I want to increase my income" examples={["I want to increase my income", "I want to land a credit role with visa sponsorship", "I want to grow my network in finance", "I want to learn skills that unlock more roles"]} />
        </div>
      </Card>

      {opps.length === 0 ? (
        <EmptyState icon={<Briefcase />} title="No opportunities yet" body="Add one manually, upload a job description, or connect the job-board integration in Settings." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STAGES.map((stage) => {
            const items = opps.filter((x) => stage.statuses.includes(x.o.status)).sort((a, b) => b.fit.score - a.fit.score);
            return (
              <div key={stage.key} className="min-w-0">
                <div className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{stage.label}</h2>
                  <span className="font-mono text-xs text-faint">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map(({ o, fit, company }) => {
                    const d = daysUntil(o.deadline, w.now);
                    return (
                      <Link key={o.id} href={`/opportunities/${o.id}`} className={cn("block rounded-xl border border-line bg-elev p-3.5 transition-colors hover:border-line-strong", stage.key === "closed" && "opacity-60")}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm leading-snug font-medium text-fg">{o.title.split("—")[0].trim()}</div>
                            <div className="mt-0.5 truncate text-xs text-muted">{company ?? o.title.split("—")[1]?.trim() ?? o.type.replace("_", " ")}</div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className={cn("font-mono text-base font-semibold", fit.score >= 0.75 ? "text-success" : fit.score >= 0.5 ? "text-accent" : "text-signal")}>{Math.round(fit.score * 100)}</div>
                            <div className="text-[10px] text-faint">fit</div>
                          </div>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                          <Badge>{o.status}</Badge>
                          {o.valueLow !== null && <Badge tone="success">{money(o.valueLow, "GBP", { compact: true })}{o.valueHigh && o.valueHigh !== o.valueLow ? `–${money(o.valueHigh, "GBP", { compact: true })}` : ""}{o.valuePeriod === "per_month" ? "/mo" : o.valuePeriod === "per_day" ? "/day" : ""}</Badge>}
                          {d !== null && d >= 0 && d <= 14 && stage.key !== "closed" && <Badge tone={d <= 3 ? "danger" : "signal"}>closes {relativeDay(o.deadline, w.now)}</Badge>}
                          {fit.visaRisk.blocked && <Badge tone="danger">no sponsorship</Badge>}
                          {fit.gaps.filter((g) => g.essential).slice(0, 1).map((g) => <Badge key={g.name} tone="warning">{g.name} gap</Badge>)}
                          {o.source === "ai_inference" && <Badge tone="signal">inferred</Badge>}
                        </div>
                      </Link>
                    );
                  })}
                  {!items.length && <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-xs text-faint">Empty</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
