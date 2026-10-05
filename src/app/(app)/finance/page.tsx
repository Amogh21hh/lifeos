import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { financeSummary } from "@/server/engine/signals";
import { money, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { AgentRunner } from "@/components/lifeos/agent-runner";
import { FinanceCharts } from "./charts";

export const metadata: Metadata = { title: "Finance" };

export default async function FinancePage() {
  const w = await getWorld();
  const f = financeSummary(w);
  const tx = [...w.transactions].sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)).slice(0, 40);
  if (!w.transactions.length && !w.accounts.length)
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader eyebrow="Financial cockpit" title="Finance" />
        <EmptyState icon={<Wallet />} title="No financial data yet" body="Connect the banking integration in Settings, or upload a CSV bank statement in Documents." />
      </div>
    );
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Financial cockpit" title="Finance" description="Cash, runway and spending patterns computed from your transactions. Averages are ESTIMATES over the last 90 days. LIFEOS describes your data; it does not give investment advice." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Liquid cash" value={money(f.liquid)} hint="current + savings · FACT" />
        <Stat label="Runway" value={`${f.runwayMonths.toFixed(1)} mo`} hint="liquid ÷ essentials · ESTIMATE" />
        <Stat label="Monthly income" value={money(f.monthlyIncome)} hint="90-day average" />
        <Stat label="Monthly spend" value={money(f.monthlyExpenses)} hint={`essentials ${money(f.monthlyEssentials)}`} />
        <Stat label="Net worth" value={money(f.netWorth)} hint="incl. investments & assets" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <FinanceCharts monthly={f.monthly} categories={f.byCategory.slice(0, 8)} />
          <Card>
            <CardHeader title="What if…" subtitle="Money scenarios with editable assumptions" />
            <div className="px-5 pb-5">
              <AgentRunner agent="FinanceAgent" input={{ op: "simulate" }} promptKey="question" label="Simulate" promptPlaceholder="What happens if I spend £300 on this?" examples={["What happens if I spend £300 on a course?", "What happens if I earn £180 per month from a retainer?", "What happens if I buy a £4,500 car?"]} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Recent transactions" />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[520px] text-sm">
                <tbody className="divide-y divide-line">
                  {tx.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-3 font-mono text-xs text-faint">{shortDate(t.occurredOn)}</td>
                      <td className="py-2 pr-3 text-fg">
                        {t.description} {t.recurring && <Badge className="ml-1">recurring</Badge>}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted">{t.category}</td>
                      <td className={cn("py-2 text-right font-mono text-sm", t.amount >= 0 ? "text-success" : "text-fg")}>{money(t.amount, "GBP", { sign: true })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Accounts" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {w.accounts.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="text-fg">
                    {a.name} <span className="text-xs text-faint">· {a.institution}</span>
                  </span>
                  <span className={cn("font-mono", a.balance < 0 ? "text-danger" : "text-fg")}>{money(a.balance)}</span>
                </li>
              ))}
              {w.assets.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted">{a.name}</span>
                  <span className="font-mono text-muted">{money(a.value)}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Recurring costs" subtitle="Detected from repeated transactions" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {f.recurring.map((r) => (
                <li key={r.description} className="flex items-center justify-between gap-2">
                  <span className="text-fg">
                    {r.description} <span className="text-xs text-faint">· {r.category}</span>
                  </span>
                  <span className="font-mono text-muted">{money(r.monthly)}/mo</span>
                </li>
              ))}
              <li className="flex justify-between border-t border-line pt-2 text-xs text-muted">
                <span>Total</span>
                <span className="font-mono">{money(f.recurring.reduce((a, r) => a + r.monthly, 0))}/mo</span>
              </li>
            </ul>
          </Card>
          <Card>
            <CardHeader title="Financial goals" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {w.goals
                .filter((g) => g.category === "finance")
                .map((g) => (
                  <li key={g.id} className="flex justify-between gap-2">
                    <span className="text-fg">{g.title}</span>
                    <span className="shrink-0 font-mono text-xs text-muted">
                      {g.currentValue}/{g.targetValue} {g.unit}
                    </span>
                  </li>
                ))}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
