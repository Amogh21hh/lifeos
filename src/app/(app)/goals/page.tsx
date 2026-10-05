import type { Metadata } from "next";
import Link from "next/link";
import { Target } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { goalLastActivity, goalProgress, projectProgress, timeAllocation } from "@/server/engine/signals";
import { daysSince, hours, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Progress } from "@/components/ui/primitives";
import { CreateEntityDialog } from "@/components/lifeos/controls";
import { EntityLink } from "@/components/lifeos/entity";

export const metadata: Metadata = { title: "Goals" };

export default async function GoalsPage() {
  const w = await getWorld();
  const alloc = timeAllocation(w, 14);
  const goals = [...w.goals].sort((a, b) => Number(a.status !== "active") - Number(b.status !== "active") || b.priority - a.priority);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Direction"
        title="Goals"
        description="What everything else is measured against. Priority drives how LIFEOS ranks actions; logged time shows whether your attention matches it."
        actions={
          <CreateEntityDialog
            type="goal"
            title="New goal"
            fields={[
              { name: "title", label: "Goal", required: true, placeholder: "e.g. Land a graduate credit role" },
              { name: "category", label: "Category", type: "select", required: true, options: ["career", "finance", "learning", "health", "relationships", "personal"].map((v) => ({ value: v, label: v })) },
              { name: "priority", label: "Priority (1–5)", type: "number", defaultValue: "3" },
              { name: "targetMetric", label: "Measure", placeholder: "e.g. Offers received" },
              { name: "targetValue", label: "Target value", type: "number" },
              { name: "currentValue", label: "Current value", type: "number" },
              { name: "unit", label: "Unit" },
              { name: "targetDate", label: "Target date", type: "date" },
            ]}
          />
        }
      />
      {goals.length === 0 ? (
        <EmptyState icon={<Target />} title="No goals yet" body="Goals give LIFEOS something to reason towards. Start with one that matters this quarter." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {goals.map((g) => {
            const pct = goalProgress(g);
            const last = goalLastActivity(w, g.id);
            const idle = daysSince(last, w.now) ?? 999;
            const projects = w.projects.filter((p) => p.goalId === g.id);
            const time = alloc.byGoal.find((x) => x.goalId === g.id);
            return (
              <Card key={g.id} className={cn(g.status !== "active" && "opacity-60")}>
                <div className="p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={g.priority >= 5 ? "accent" : g.priority >= 4 ? "signal" : "neutral"}>P{g.priority}</Badge>
                        <Badge>{g.category}</Badge>
                        {g.status !== "active" && <Badge>{g.status}</Badge>}
                        {g.status === "active" && idle >= w.settings.neglectDays && <Badge tone="warning">quiet {idle}d</Badge>}
                      </div>
                      <Link href={`/goals/${g.id}`} className="mt-2 block font-medium text-fg hover:text-accent">
                        {g.title}
                      </Link>
                    </div>
                    {pct !== null && <span className="font-mono text-lg font-semibold text-fg">{Math.round(pct * 100)}%</span>}
                  </div>
                  {pct !== null && <Progress value={pct} className="mt-3" tone={pct >= 1 ? "success" : "accent"} />}
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                    {g.targetMetric && (
                      <span>
                        {g.targetMetric}: {g.currentValue ?? "?"} / {g.targetValue ?? "?"} {g.unit}
                      </span>
                    )}
                    {g.targetDate && <span>Target {relativeDay(g.targetDate, w.now)}</span>}
                    <span>{time ? `${hours(time.minutes)} in 14 days` : "no time logged in 14 days"}</span>
                  </div>
                  {projects.length > 0 && (
                    <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                      {projects.map((p) => (
                        <li key={p.id} className="flex items-center justify-between gap-3 text-sm">
                          <EntityLink entity={{ type: "project", id: p.id, label: p.title }} />
                          <span className="shrink-0 font-mono text-xs text-faint">{Math.round(projectProgress(w, p.id).pct * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Card className="mt-8">
        <CardHeader title="Credentials & courses" />
        <div className="grid gap-x-8 gap-y-2 px-5 pb-5 text-sm sm:grid-cols-2">
          {w.credentials.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <span className="text-fg">{c.name}</span>
              <span className="text-xs text-muted">{c.status}{c.examDate ? ` · exam ${relativeDay(c.examDate, w.now)}` : ""}{c.expiresAt ? ` · expires ${relativeDay(c.expiresAt, w.now)}` : ""}</span>
            </div>
          ))}
          {w.courses.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <span className="text-fg">{c.title}</span>
              <span className="font-mono text-xs text-muted">{c.hoursDone}/{c.hoursTotal ?? "?"}h</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
