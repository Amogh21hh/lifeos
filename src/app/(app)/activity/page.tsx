import type { Metadata } from "next";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { Bot, Cpu, ShieldCheck, Wrench } from "lucide-react";
import * as s from "@/server/db/schema";
import { getViewer } from "@/server/services/context";
import { aiStatus } from "@/server/ai/llm";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Stat } from "@/components/ui/primitives";
import { ApprovalCard } from "@/components/lifeos/blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/overlays";

export const metadata: Metadata = { title: "AI activity" };

export default async function ActivityPage() {
  const { db, user } = await getViewer();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [runs, calls, approvals, [totals]] = await Promise.all([
    db.select().from(s.aiRuns).where(eq(s.aiRuns.userId, user.id)).orderBy(desc(s.aiRuns.createdAt)).limit(60),
    db.select().from(s.toolCalls).where(eq(s.toolCalls.userId, user.id)).orderBy(desc(s.toolCalls.createdAt)).limit(120),
    db.select().from(s.approvals).where(eq(s.approvals.userId, user.id)).orderBy(desc(s.approvals.createdAt)).limit(60),
    db
      .select({ runs: sql<number>`count(*)::int`, tokens: sql<number>`coalesce(sum(${s.aiRuns.inputTokens} + ${s.aiRuns.outputTokens}),0)::int`, cost: sql<number>`coalesce(sum(${s.aiRuns.costUsd}),0)::float`, avgMs: sql<number>`coalesce(avg(${s.aiRuns.latencyMs}),0)::int`, errors: sql<number>`count(*) filter (where ${s.aiRuns.status} = 'error')::int` })
      .from(s.aiRuns)
      .where(and(eq(s.aiRuns.userId, user.id), gte(s.aiRuns.createdAt, since))),
  ]);
  const pending = approvals.filter((a) => a.status === "pending");
  const ai = aiStatus();
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Transparency" title="AI activity" description="Everything the AI did: which agent ran, which tools it called, what data it touched, what it cost — and every action waiting for your approval." />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Agent runs (30d)" value={totals?.runs ?? 0} />
        <Stat label="Awaiting approval" value={pending.length} hint="nothing runs without you" />
        <Stat label="Avg latency" value={`${totals?.avgMs ?? 0} ms`} />
        <Stat label="Tokens (30d)" value={(totals?.tokens ?? 0).toLocaleString("en-GB")} hint={ai.available ? ai.model ?? "" : "local engine: 0 tokens"} />
        <Stat label="Cost (30d)" value={`$${(totals?.cost ?? 0).toFixed(3)}`} hint={`${totals?.errors ?? 0} errors`} />
      </div>
      <Tabs defaultValue={pending.length ? "approvals" : "runs"}>
        <TabsList>
          <TabsTrigger value="approvals"><ShieldCheck /> Approvals {pending.length > 0 && <Badge tone="signal">{pending.length}</Badge>}</TabsTrigger>
          <TabsTrigger value="runs"><Bot /> Agent runs</TabsTrigger>
          <TabsTrigger value="tools"><Wrench /> Tool calls</TabsTrigger>
        </TabsList>
        <TabsContent value="approvals">
          <div className="space-y-3">
            {approvals.length === 0 && <EmptyState icon={<ShieldCheck />} title="No proposed actions" body="When an agent wants to create, send, change or delete something, it appears here for your approval." />}
            {approvals.map((a) => (
              <div key={a.id}>
                <div className="mb-1 flex items-center gap-2 text-[11px] text-faint">
                  <span>{a.agent}</span>·<span>{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                </div>
                <ApprovalCard approvalId={a.id} title={a.title} explanation={a.explanation} risk={a.risk} tool={a.tool} initialStatus={a.status} payload={a.payload} />
              </div>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="runs">
          <Card>
            <ul className="divide-y divide-line">
              {runs.map((r) => {
                const out = r.output as { summary?: string; trace?: { kind: string; name: string; status: string }[] } | null;
                const tools = (out?.trace ?? []).filter((t) => t.kind === "tool");
                return (
                  <li key={r.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">{r.agent}</Badge>
                      {r.intent && <Badge>{r.intent.replace(/_/g, " ")}</Badge>}
                      <Badge tone={r.status === "ok" ? "success" : r.status === "error" ? "danger" : r.status === "running" ? "neutral" : "warning"}>{r.status}</Badge>
                      <span className="flex items-center gap-1 font-mono text-[11px] text-faint">
                        <Cpu className="size-3" /> {r.engine}
                        {r.model ? ` · ${r.model}` : ""} · {r.latencyMs ?? "?"} ms{r.inputTokens + r.outputTokens ? ` · ${r.inputTokens + r.outputTokens} tok · $${r.costUsd.toFixed(4)}` : ""}
                      </span>
                      <span className="ml-auto font-mono text-[11px] text-faint">{r.createdAt.toISOString().slice(0, 16).replace("T", " ")}</span>
                    </div>
                    {out?.summary && <p className="mt-1.5 line-clamp-2 text-sm text-fg/90">{out.summary}</p>}
                    {r.error && <p className="mt-1 text-sm text-danger">{r.error}</p>}
                    {tools.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {tools.map((t, i) => (
                          <span key={i} className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px]", t.status === "ok" ? "border-line text-muted" : t.status === "pending_approval" ? "border-signal/40 text-signal" : "border-danger/40 text-danger")}>
                            {t.name}:{t.status}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
              {!runs.length && <li className="px-4 py-6 text-sm text-muted">No agent runs yet. Try the Command Center.</li>}
            </ul>
          </Card>
        </TabsContent>
        <TabsContent value="tools">
          <Card>
            <CardHeader title="Tool audit log" subtitle="Every tool call with its permission level, the data it accessed and its outcome" />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-faint uppercase">
                    <th className="pb-2 font-medium">Time</th>
                    <th className="pb-2 font-medium">Tool</th>
                    <th className="pb-2 font-medium">Agent</th>
                    <th className="pb-2 font-medium">Permission</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">Accessed</th>
                    <th className="pb-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {calls.map((c) => (
                    <tr key={c.id}>
                      <td className="py-1.5 pr-2 font-mono text-[11px] text-faint">{c.createdAt.toISOString().slice(5, 16).replace("T", " ")}</td>
                      <td className="py-1.5 pr-2 font-mono text-xs text-fg">{c.tool}</td>
                      <td className="py-1.5 pr-2 text-xs text-muted">{c.agent}</td>
                      <td className="py-1.5 pr-2">
                        <Badge tone={c.permission === "read" ? "neutral" : c.permission === "destructive" ? "danger" : "signal"}>{c.permission}</Badge>
                      </td>
                      <td className={cn("py-1.5 pr-2 text-xs", c.status === "ok" ? "text-success" : c.status === "pending_approval" ? "text-signal" : "text-danger")}>{c.status}</td>
                      <td className="py-1.5 pr-2 font-mono text-[11px] text-faint">{c.entitiesAccessed.length ? `${c.entitiesAccessed.length} records` : "—"}</td>
                      <td className="max-w-64 truncate py-1.5 text-xs text-muted" title={c.error ?? c.outputSummary ?? ""}>
                        {c.error ?? c.outputSummary ?? ""} {c.latencyMs !== null && <span className="text-faint">({c.latencyMs}ms)</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!calls.length && <p className="text-sm text-muted">No tool calls yet.</p>}
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
