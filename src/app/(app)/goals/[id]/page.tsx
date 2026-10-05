import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getWorld, visible } from "@/server/services/context";
import { goalLastActivity, goalProgress, projectProgress } from "@/server/engine/signals";
import { whatAmIMissing } from "@/server/engine/missing";
import { rankActions } from "@/server/engine/actions";
import { linksOf, refOf } from "@/server/engine/world";
import { relativeDay, shortDate } from "@/lib/format";
import { Badge, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { EntitySelect } from "@/components/lifeos/controls";
import { EntityLink } from "@/components/lifeos/entity";
import { InsightCard } from "@/components/lifeos/insight-card";
import { GoalValueEditor } from "./value-editor";

export const metadata: Metadata = { title: "Goal" };

export default async function GoalPage(props: PageProps<"/goals/[id]">) {
  const { id } = await props.params;
  const w = await getWorld();
  const g = w.idx.goal.get(id);
  if (!g) notFound();
  const pct = goalProgress(g);
  const projects = w.projects.filter((p) => p.goalId === g.id);
  const links = linksOf(w, "goal", g.id).filter((l) => l.fromType !== "goal");
  const related = (await visible([...rankActions(w), ...whatAmIMissing(w)])).filter((i) => (i.refs ?? []).some((r) => r.id === g.id) || i.scoreBreakdown?.[0]?.note.includes(g.title)).slice(0, 6);
  const activity = w.activities.filter((a) => a.goalId === g.id || projects.some((p) => p.id === a.entityId)).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 12);
  const last = goalLastActivity(w, g.id);
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/goals" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Goals
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="accent">P{g.priority}</Badge>
            <Badge>{g.category}</Badge>
            <Badge>{g.horizon}</Badge>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{g.title}</h1>
          {g.description && <p className="mt-1 max-w-2xl text-sm text-muted">{g.description}</p>}
          <p className="mt-1 text-xs text-faint">Last activity {last ? `${shortDate(last)} (${relativeDay(last, w.now)})` : "never"}{g.targetDate ? ` · target ${shortDate(g.targetDate)}` : ""}</p>
        </div>
        <EntitySelect type="goal" id={g.id} field="status" value={g.status} options={["active", "paused", "achieved", "abandoned"]} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          {g.targetMetric && (
            <Card className="p-5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{g.targetMetric}</span>
                <span className="font-mono text-fg">
                  {g.currentValue ?? "?"} / {g.targetValue ?? "?"} {g.unit}
                </span>
              </div>
              {pct !== null && <Progress value={pct} className="mt-2" />}
              <GoalValueEditor id={g.id} current={g.currentValue} />
            </Card>
          )}
          <Card>
            <CardHeader title="Recommendations touching this goal" subtitle="Ranked actions and blind spots that cite it" />
            <div className="space-y-2 px-4 pb-4">
              {related.length ? related.map((i) => <InsightCard key={i.key} item={i} compact dismissible />) : <p className="px-1 text-sm text-muted">Nothing pressing for this goal.</p>}
            </div>
          </Card>
          <Card>
            <CardHeader title="Activity" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-muted">{a.summary}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{shortDate(a.occurredAt)}</span>
                </li>
              ))}
              {!activity.length && <li className="text-faint">No activity yet.</li>}
            </ul>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Projects" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2">
                  <EntityLink entity={{ type: "project", id: p.id, label: p.title }} />
                  <span className="font-mono text-xs text-faint">{Math.round(projectProgress(w, p.id).pct * 100)}%</span>
                </li>
              ))}
              {!projects.length && <li className="text-faint">No projects yet — this goal has no vehicle.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Supported by" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {links.map((l) => (
                <li key={l.id}>
                  <EntityLink entity={refOf(w, l.fromType as never, l.fromId)} />
                </li>
              ))}
              {!links.length && <li className="text-faint">Nothing linked.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
