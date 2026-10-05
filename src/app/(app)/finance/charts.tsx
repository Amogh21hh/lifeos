"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardHeader } from "@/components/ui/primitives";

const tooltip = { background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 };

export function FinanceCharts({ monthly, categories }: { monthly: { month: string; income: number; expenses: number }[]; categories: { category: string; monthly: number }[] }) {
  const months = monthly.map((m) => ({ ...m, income: Math.round(m.income), expenses: Math.round(m.expenses), label: new Date(`${m.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) }));
  const cats = categories.map((c) => ({ category: c.category, monthly: Math.round(c.monthly) }));
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card>
        <CardHeader title="Income vs spending" subtitle="By calendar month · FACT" />
        <div className="h-60 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={months} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="var(--text-faint)" fontSize={11} tickLine={false} />
              <YAxis stroke="var(--text-faint)" fontSize={11} tickLine={false} tickFormatter={(v) => `£${v}`} />
              <Tooltip contentStyle={tooltip} formatter={(v) => `£${v}`} cursor={{ fill: "var(--bg-hover)" }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="income" name="Income" fill="var(--success)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="expenses" name="Spending" fill="var(--accent)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <CardHeader title="Spending by category" subtitle="Monthly average · ESTIMATE" />
        <div className="h-60 px-2 pb-4">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cats} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" stroke="var(--text-faint)" fontSize={11} tickLine={false} tickFormatter={(v) => `£${v}`} />
              <YAxis type="category" dataKey="category" stroke="var(--text-faint)" fontSize={11} tickLine={false} width={84} />
              <Tooltip contentStyle={tooltip} formatter={(v) => `£${v}/mo`} cursor={{ fill: "var(--bg-hover)" }} />
              <Bar dataKey="monthly" fill="var(--signal)" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
