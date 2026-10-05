import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarClock, CheckCircle2, Link2, ListTodo, Plus, Rocket } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { projectLastActivity, projectProgress } from "@/server/engine/signals";
import { linksOf, refOf } from "@/server/engine/world";
import { hours, relativeDay, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { AgentRunner } from "@/components/lifeos/agent-runner";
import { CreateEntityDialog, EntityAction, EntitySelect } from "@/components/lifeos/controls";
import { EntityLink } from "@/components/lifeos/entity";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage(props: PageProps<"/projects/[id]">) {
  const { id } = await props.params;
  const w = await getWorld();
  const p = w.idx.project.get(id);
  if (!p) notFound();
  const prog = projectProgress(w, p.id);
  const tasks = [...(w.idx.tasksByProject.get(p.id) ?? [])].sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  const goal = p.goalId ? w.idx.goal.get(p.goalId) : undefined;
  const links = linksOf(w, "project", p.id);
  const last = projectLastActivity(w, p.id);
  const events = w.events.filter((e) => e.projectId === p.id && e.startsAt > w.now);
  const activity = w.activities.filter((a) => (a.entityType === "project" && a.entityId === p.id) || (a.entityType === "task" && tasks.some((t) => t.id === a.entityId))).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime()).slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Projects
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          {goal && <EntityLink entity={{ type: "goal", id: goal.id, label: goal.title }} className="text-sm text-muted" />}
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{p.title}</h1>
          {p.description && <p className="mt-1 max-w-2xl text-sm text-muted">{p.description}</p>}
        </div>
        <EntitySelect type="project" id={p.id} field="status" value={p.status} options={["planning", "active", "blocked", "paused", "done"]} />
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-elev px-4 py-3 sm:col-span-2">
          <div className="flex items-center justify-between text-[11px] tracking-wide text-muted uppercase">
            Progress (by effort) <span className="font-mono text-base text-fg">{Math.round(prog.pct * 100)}%</span>
          </div>
          <Progress value={prog.pct} className="mt-2" />
          <div className="mt-1.5 text-xs text-faint">{prog.doneCount}/{prog.totalCount} tasks · {hours(prog.remainingMinutes)} remaining</div>
        </div>
        <div className="rounded-xl border border-line bg-elev px-4 py-3">
          <div className="text-[11px] tracking-wide text-muted uppercase">Due</div>
          <div className="mt-1 font-mono text-lg text-fg">{p.dueDate ? shortDate(p.dueDate) : "—"}</div>
          <div className="text-xs text-faint">{p.dueDate ? relativeDay(p.dueDate, w.now) : "no date"}</div>
        </div>
        <div className="rounded-xl border border-line bg-elev px-4 py-3">
          <div className="text-[11px] tracking-wide text-muted uppercase">Last activity</div>
          <div className="mt-1 font-mono text-lg text-fg">{last ? shortDate(last) : "—"}</div>
          <div className="text-xs text-faint">{last ? relativeDay(last, w.now) : "never"}</div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card className="border-accent/30">
            <CardHeader title="Project autopilot" icon={<Rocket className="text-accent" />} subtitle="Inspects tasks, estimates, dependencies, deadlines, people and linked opportunities — then plans the next concrete steps." />
            <div className="px-5 pb-5">
              <AgentRunner agent="ProjectAgent" input={{ op: "autopilot", projectId: p.id }} label="Move this project forward" icon={<Rocket />} />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Tasks"
              icon={<ListTodo />}
              actions={
                <CreateEntityDialog
                  type="task"
                  title="New task"
                  extra={{ projectId: p.id }}
                  trigger={
                    <Button size="sm">
                      <Plus /> Task
                    </Button>
                  }
                  fields={[
                    { name: "title", label: "Title", required: true },
                    { name: "dueDate", label: "Due", type: "date" },
                    { name: "estimateMinutes", label: "Estimate (minutes)", type: "number" },
                  ]}
                />
              }
            />
            <ul className="divide-y divide-line border-t border-line">
              {tasks.map((t) => {
                const dep = t.dependsOnTaskId ? w.idx.task.get(t.dependsOnTaskId) : undefined;
                const blocked = t.status === "blocked" || (dep && dep.status !== "done");
                const overdue = t.status !== "done" && t.dueDate && t.dueDate < w.now.toISOString().slice(0, 10);
                return (
                  <li key={t.id} id={`task-${t.id}`} className={cn("flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center", t.status === "done" && "opacity-55")}>
                    <div className="min-w-0 flex-1">
                      <div className={cn("text-sm text-fg", t.status === "done" && "line-through")}>{t.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {t.estimateMinutes && <Badge>{hours(t.estimateMinutes)}</Badge>}
                        {t.dueDate && t.status !== "done" && <Badge tone={overdue ? "danger" : "neutral"}>due {relativeDay(t.dueDate, w.now)}</Badge>}
                        {blocked && <Badge tone="danger">blocked{dep && dep.status !== "done" ? ` by “${dep.title.slice(0, 30)}”` : ""}</Badge>}
                        {t.postponedCount >= 2 && <Badge tone="warning">postponed {t.postponedCount}×</Badge>}
                        {t.source !== "user" && <Badge tone="accent">{t.source}</Badge>}
                      </div>
                    </div>
                    {t.status !== "done" && (
                      <div className="flex shrink-0 items-center gap-1">
                        <EntitySelect type="task" id={t.id} field="status" value={t.status} options={["todo", "in_progress", "blocked", "done", "cancelled"]} />
                        <EntityAction type="task" id={t.id} body={{ action: "postpone" }} label="Postpone a day" icon={<CalendarClock />} size="icon-sm" variant="ghost" success="Postponed — LIFEOS tracks repeated postponement" />
                        <EntityAction type="task" id={t.id} body={{ status: "done" }} label="Complete" icon={<CheckCircle2 />} size="icon-sm" variant="ghost" success="Completed" />
                      </div>
                    )}
                  </li>
                );
              })}
              {!tasks.length && <li className="px-5 py-4 text-sm text-muted">No tasks yet.</li>}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          {p.currentState && (
            <Card>
              <CardHeader title="Current state" />
              <p className="px-5 pb-5 text-sm text-fg/90">{p.currentState}</p>
            </Card>
          )}
          <Card>
            <CardHeader title="Connected" icon={<Link2 />} />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {links.map((l) => {
                const other = l.fromType === "project" && l.fromId === p.id ? refOf(w, l.toType as never, l.toId) : refOf(w, l.fromType as never, l.fromId);
                return (
                  <li key={l.id} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-faint">{l.relation.replace("_", " ")}</span>
                    <EntityLink entity={other} />
                  </li>
                );
              })}
              {!links.length && <li className="text-faint">No links.</li>}
            </ul>
          </Card>
          {events.length > 0 && (
            <Card>
              <CardHeader title="Upcoming" icon={<CalendarClock />} />
              <ul className="space-y-2 px-5 pb-5 text-sm">
                {events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="text-fg">{e.title}</span>
                    <span className="shrink-0 font-mono text-xs text-accent">{relativeDay(e.startsAt, w.now)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card>
            <CardHeader title="Activity" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {activity.map((a) => (
                <li key={a.id} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate text-muted">{a.summary}</span>
                  <span className="shrink-0 font-mono text-[11px] text-faint">{shortDate(a.occurredAt)}</span>
                </li>
              ))}
              {!activity.length && <li className="text-faint">No activity recorded.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
