import type { Metadata } from "next";
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { projectLastActivity, projectProgress } from "@/server/engine/signals";
import { daysSince, hours, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, EmptyState, PageHeader, Progress } from "@/components/ui/primitives";
import { CreateEntityDialog } from "@/components/lifeos/controls";

export const metadata: Metadata = { title: "Projects" };

const ORDER = ["active", "blocked", "planning", "paused", "done"];

export default async function ProjectsPage() {
  const w = await getWorld();
  const rows = w.projects
    .map((p) => ({ p, prog: projectProgress(w, p.id), idle: daysSince(projectLastActivity(w, p.id), w.now), goal: p.goalId ? w.idx.goal.get(p.goalId) : undefined }))
    .sort((a, b) => ORDER.indexOf(a.p.status) - ORDER.indexOf(b.p.status) || b.p.priority - a.p.priority);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Project autopilot"
        title="Projects"
        description="Progress is measured by estimated effort, not task count. Open a project and press “Move this project forward” for a concrete plan that starts with the smallest useful next action."
        actions={
          <CreateEntityDialog
            type="project"
            title="New project"
            fields={[
              { name: "title", label: "Title", required: true },
              { name: "goalId", label: "Goal", type: "select", options: w.goals.filter((g) => g.status === "active").map((g) => ({ value: g.id, label: g.title })) },
              { name: "dueDate", label: "Due date", type: "date" },
              { name: "description", label: "Description", type: "textarea" },
            ]}
          />
        }
      />
      {rows.length === 0 ? (
        <EmptyState icon={<FolderKanban />} title="No projects yet" body="Create a project, or turn an uploaded document into one from the Command Center." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map(({ p, prog, idle, goal }) => (
            <Link key={p.id} href={`/projects/${p.id}`} className={cn("block rounded-xl border border-line bg-elev p-4 transition-colors hover:border-line-strong", p.status === "done" && "opacity-60")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-fg">{p.title}</div>
                  {goal && <div className="mt-0.5 truncate text-xs text-muted">→ {goal.title}</div>}
                </div>
                <span className="font-mono text-lg font-semibold text-fg">{Math.round(prog.pct * 100)}%</span>
              </div>
              <Progress value={prog.pct} className="mt-3" tone={p.status === "blocked" ? "danger" : prog.pct >= 0.8 ? "success" : "accent"} />
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <Badge tone={p.status === "blocked" ? "danger" : p.status === "active" ? "accent" : "neutral"}>{p.status}</Badge>
                <Badge>{prog.remaining.length} open · {hours(prog.remainingMinutes)}</Badge>
                {prog.blocked.length > 0 && <Badge tone="danger">{prog.blocked.length} blocked</Badge>}
                {p.dueDate && p.status !== "done" && <Badge tone="signal">due {relativeDay(p.dueDate, w.now)}</Badge>}
                {idle !== null && idle >= 7 && p.status !== "done" && <Badge tone="warning">idle {idle}d</Badge>}
              </div>
              {p.currentState && <p className="mt-2 line-clamp-2 text-xs text-muted">{p.currentState}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
