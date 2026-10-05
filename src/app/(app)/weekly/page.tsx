import type { Metadata } from "next";
import Link from "next/link";
import { CalendarRange, CheckCircle2, Clock, Compass, HeartHandshake, Lightbulb, PauseCircle, Sparkles, TrendingDown, TrendingUp, Wallet, XCircle } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { weeklyReport } from "@/server/engine/weekly";
import { hours, longDate, money, relativeDay, shortDate } from "@/lib/format";
import { Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { InsightCard } from "@/components/lifeos/insight-card";
import { RefreshButton } from "@/components/lifeos/refresh-button";

export const metadata: Metadata = { title: "Weekly report" };

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} icon={icon} />
      <div className="px-5 pb-5 text-sm">{children}</div>
    </Card>
  );
}

const Empty = ({ text }: { text: string }) => <p className="text-faint">{text}</p>;

export default async function WeeklyPage() {
  const w = await getWorld();
  const r = weeklyReport(w);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow={`Week of ${longDate(r.weekStart)} → ${longDate(r.weekEnd)}`} title="Weekly intelligence report" description={r.headline} actions={<RefreshButton label="Regenerate" />} />

      <Card className="mb-6 border-accent/30">
        <CardHeader title="Recommended focus" icon={<Compass className="text-accent" />} subtitle="Top-ranked actions, at most one per goal. Each explains why." />
        <ol className="space-y-2 px-5 pb-5">
          {r.focus.map((f, i) => (
            <li key={i} className="flex gap-3 rounded-lg border border-line bg-sunken px-3 py-2.5">
              <span className="font-mono text-sm font-semibold text-accent">{i + 1}</span>
              <div>
                <div className="text-sm font-medium text-fg">{f.title}</div>
                <div className="text-xs text-muted">{f.why}</div>
                {f.goal && <div className="mt-0.5 text-[11px] text-faint">Serves “{f.goal}”</div>}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title={`Wins (${r.wins.length})`} icon={<CheckCircle2 className="text-success" />}>
          {r.wins.length ? <ul className="list-disc space-y-1 pl-4 text-fg/90 marker:text-success">{r.wins.map((x, i) => <li key={i}>{x}</li>)}</ul> : <Empty text="No completions logged this week." />}
        </Section>

        <Section title="Progress by goal" icon={<TrendingUp />}>
          <ul className="space-y-1.5">
            {r.progress.slice(0, 8).map((p) => (
              <li key={p.goalId} className="flex items-center justify-between gap-2">
                <Link href={`/goals/${p.goalId}`} className="min-w-0 truncate text-fg hover:text-accent">
                  {p.goal}
                </Link>
                <span className="flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
                  {hours(p.minutes)}
                  {p.trend === "up" ? <TrendingUp className="size-3 text-success" /> : p.trend === "down" ? <TrendingDown className="size-3 text-danger" /> : null}
                  {p.progress !== null && <span>{Math.round(p.progress * 100)}%</span>}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Stalled projects" icon={<PauseCircle className="text-signal" />}>
          {r.stalledProjects.length ? (
            <ul className="space-y-1.5">
              {r.stalledProjects.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <Link href={`/projects/${p.id}`} className="text-fg hover:text-accent">{p.title}</Link>
                  <span className="shrink-0 font-mono text-xs text-muted">idle {p.idleDays}d · {Math.round(p.pct * 100)}%</span>
                </li>
              ))}
            </ul>
          ) : <Empty text="Everything moved this week." />}
        </Section>

        <Section title="Missed commitments & overdue tasks" icon={<XCircle className="text-danger" />}>
          {r.missedCommitments.length ? (
            <ul className="space-y-1.5">
              {r.missedCommitments.map((m, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="text-fg">{m.title}{m.to ? <span className="text-xs text-faint"> · to {m.to}</span> : null}</span>
                  <span className="shrink-0 font-mono text-xs text-danger">{shortDate(m.due)}</span>
                </li>
              ))}
            </ul>
          ) : <Empty text="Nothing overdue." />}
        </Section>

        <Section title="New opportunities" icon={<Sparkles className="text-signal" />}>
          {r.newOpportunities.length ? (
            <ul className="space-y-1.5">
              {r.newOpportunities.map((o) => (
                <li key={o.id} className="flex justify-between gap-2">
                  <Link href={`/opportunities/${o.id}`} className="text-fg hover:text-accent">{o.title}</Link>
                  <span className="shrink-0 text-xs text-faint">{o.source}</span>
                </li>
              ))}
            </ul>
          ) : <Empty text="No new opportunities this week." />}
        </Section>

        <Section title="Upcoming deadlines (14 days)" icon={<Clock />}>
          <ul className="space-y-1.5">
            {r.upcomingDeadlines.map((d, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0 truncate text-fg">{d.label}</span>
                <span className="shrink-0 font-mono text-xs text-muted">{relativeDay(d.date, w.now)}</span>
              </li>
            ))}
            {!r.upcomingDeadlines.length && <Empty text="No deadlines in the next two weeks." />}
          </ul>
        </Section>

        <Section title="Skill development" icon={<Lightbulb />}>
          <ul className="space-y-1.5">
            {r.skillDevelopment.map((s, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-fg">{s.skill}</span>
                <span className="shrink-0 text-xs text-muted">{s.note}</span>
              </li>
            ))}
            {!r.skillDevelopment.length && <Empty text="No skill practice logged." />}
          </ul>
        </Section>

        <Section title="Financial overview" icon={<Wallet />}>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-[11px] text-faint uppercase">In</div>
              <div className="font-mono text-success">{money(r.finance.income)}</div>
            </div>
            <div>
              <div className="text-[11px] text-faint uppercase">Out</div>
              <div className="font-mono text-fg">{money(r.finance.expenses)}</div>
            </div>
            <div>
              <div className="text-[11px] text-faint uppercase">Typical week</div>
              <div className="font-mono text-muted">{money(r.finance.avgWeeklyExpenses)}</div>
            </div>
          </div>
          {r.finance.notable.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-4 text-muted">{r.finance.notable.map((n) => <li key={n}>{n}</li>)}</ul>}
        </Section>

        <Section title="Relationship follow-ups" icon={<HeartHandshake />}>
          <ul className="space-y-1.5">
            {r.relationshipFollowUps.map((p) => (
              <li key={p.id} className="flex justify-between gap-2">
                <Link href={`/people/${p.id}`} className="text-fg hover:text-accent">{p.name}</Link>
                <span className="shrink-0 text-xs text-muted">{p.reason}</span>
              </li>
            ))}
            {!r.relationshipFollowUps.length && <Empty text="Nobody is waiting on you." />}
          </ul>
        </Section>

        <Section title="Time allocation" icon={<CalendarRange />}>
          <ul className="space-y-2">
            {r.allocation.byGoal.slice(0, 6).map((g) => (
              <li key={g.goalId ?? "none"}>
                <div className="flex justify-between text-xs">
                  <span className="truncate text-muted">{g.title}</span>
                  <span className="font-mono text-faint">{Math.round(g.share * 100)}%</span>
                </div>
                <div className="mt-1 h-1.5 rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${g.share * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      <section className="mt-6">
        <h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">AI-detected patterns</h2>
        <div className="space-y-2">{r.patterns.length ? r.patterns.map((p) => <InsightCard key={p.key} item={p} />) : <Empty text="No patterns detected." />}</div>
      </section>
    </div>
  );
}
