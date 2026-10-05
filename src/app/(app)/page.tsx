import Link from "next/link";
import { ArrowRight, CalendarClock, Clock, Gauge, ScanSearch, Sparkles, Zap } from "lucide-react";
import { buildBriefing } from "@/server/engine/briefing";
import { getWorld, visible } from "@/server/services/context";
import { hours, longDate, relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader, EmptyState, Stat, buttonVariants } from "@/components/ui/primitives";
import { InsightCard } from "@/components/lifeos/insight-card";
import { EntityIcon, entityHref } from "@/components/lifeos/entity";
import { QuickAsk } from "@/components/lifeos/quick-ask";
import { ProvenanceLegend } from "@/components/lifeos/provenance";

export default async function TodayPage() {
  const w = await getWorld();
  const b = buildBriefing(w);
  const actions = await visible(b.actions);
  const missing = await visible(b.missing);
  const empty = w.goals.length === 0 && w.projects.length === 0 && w.opportunities.length === 0;

  return (
    <div className="mx-auto max-w-7xl">
      <section className="mb-8 animate-fade-in">
        <div className="font-mono text-[11px] tracking-[0.25em] text-accent uppercase">Today · {longDate(w.now)}</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-fg sm:text-4xl">{b.greeting.toUpperCase()}</h1>
        <p className="mt-2 max-w-2xl text-lg text-muted">{empty ? "Your world is empty. Add a goal, upload a document, or try the demo workspace to see LIFEOS reason." : b.headline}</p>
        <QuickAsk className="mt-5 max-w-2xl" suggestions={["What should I focus on this week?", "What am I missing?", "I want to increase my income", "Show me what changed since last week"]} />
      </section>

      {empty ? (
        <EmptyState
          icon={<Sparkles />}
          title="Nothing to reason over yet"
          body="LIFEOS builds its briefing from your goals, projects, opportunities, documents and activity. Start with a goal or a document."
          action={
            <div className="flex gap-2">
              <Link href="/goals" className={buttonVariants({ variant: "primary" })}>
                Add a goal
              </Link>
              <Link href="/documents" className={buttonVariants()}>
                Upload a document
              </Link>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {b.stats.map((s) => (
              <Stat key={s.label} label={s.label} value={s.value} hint={s.hint} />
            ))}
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <Card>
                <CardHeader title="Highest-leverage actions" icon={<Zap className="text-accent" />} subtitle="Ranked by impact × urgency × confidence ÷ effort. Open any item to see the full reasoning." />
                <div className="space-y-2 px-4 pb-4">
                  {actions.length ? actions.map((a, i) => <InsightCard key={a.key} item={a} rank={i + 1} defaultOpen={i === 0} dismissible />) : <p className="px-1 text-sm text-muted">No pressing actions. Use the time for your top goal.</p>}
                </div>
              </Card>

              <Card>
                <CardHeader
                  title="Things you might be missing"
                  icon={<ScanSearch className="text-signal" />}
                  subtitle="Blind spots that aren't already in your top actions — each cites the records it's based on."
                  actions={
                    <Link href="/missing" className={cn(buttonVariants({ variant: "signal", size: "sm" }))}>
                      What am I missing? <ArrowRight />
                    </Link>
                  }
                />
                <div className="space-y-2 px-4 pb-4">
                  {missing.length ? missing.map((m) => <InsightCard key={m.key} item={m} compact dismissible />) : <p className="px-1 text-sm text-muted">No blind spots detected right now.</p>}
                </div>
              </Card>
            </div>

            <div className="space-y-6">
              {b.systemInsight && (
                <Card className="overflow-hidden">
                  <CardHeader title="System insight" icon={<Gauge className="text-p-ai" />} />
                  <div className="px-5 pb-4">
                    <p className="text-sm leading-relaxed text-fg">“{b.systemInsight.conclusion}”</p>
                    <div className="mt-4 space-y-2">
                      {b.allocation.byGoal.slice(0, 6).map((g) => (
                        <div key={g.goalId ?? "none"}>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="truncate text-muted">
                              {g.priority > 0 && <span className="mr-1 font-mono text-faint">P{g.priority}</span>}
                              {g.title}
                            </span>
                            <span className="shrink-0 font-mono text-faint">{Math.round(g.share * 100)}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-sunken">
                            <div className={cn("h-full rounded-full", g.priority >= 5 ? "bg-accent" : g.priority >= 3 ? "bg-signal/70" : "bg-line-strong")} style={{ width: `${g.share * 100}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-3 text-[11px] text-faint">Logged time, last 7 days · {hours(b.allocation.totalMinutes)} total · FACT</p>
                  </div>
                </Card>
              )}

              <Card>
                <CardHeader title="Next 48 hours" icon={<CalendarClock />} />
                <ul className="space-y-1 px-3 pb-4">
                  {b.agenda.length ? (
                    b.agenda.map((e) => (
                      <li key={e.id}>
                        <Link href={e.href ?? "#"} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover">
                          <span className="w-14 shrink-0 font-mono text-xs text-accent">{new Date(e.startsAt).toISOString().slice(11, 16)}</span>
                          <span className="min-w-0 flex-1 truncate text-sm text-fg">{e.title}</span>
                          <Badge>{e.when}</Badge>
                        </Link>
                      </li>
                    ))
                  ) : (
                    <li className="px-2 text-sm text-muted">Nothing scheduled.</li>
                  )}
                </ul>
              </Card>

              <Card>
                <CardHeader title="Deadlines" icon={<Clock />} subtitle="Tasks, opportunities, promises and dates found in documents" />
                <ul className="space-y-0.5 px-3 pb-4">
                  {b.deadlines.map((d, i) => (
                    <li key={i}>
                      <Link href={entityHref(d.ref)} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-hover">
                        <EntityIcon type={d.ref.type} />
                        <span className="min-w-0 flex-1 truncate text-sm text-fg/90">{d.label}</span>
                        <span className={cn("shrink-0 font-mono text-[11px]", d.days < 0 ? "text-danger" : d.days <= 1 ? "text-signal" : "text-faint")}>{d.days < 0 ? `${-d.days}d late` : relativeDay(d.date, w.now)}</span>
                      </Link>
                    </li>
                  ))}
                  {!b.deadlines.length && <li className="px-2 text-sm text-muted">No deadlines in the next two weeks.</li>}
                </ul>
              </Card>

              <Card className="px-5 py-4">
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">How to read LIFEOS</div>
                <ProvenanceLegend />
                <p className="mt-2 text-xs text-faint">Every conclusion is tagged by where it came from. Estimates and inferences are never presented as facts.</p>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
