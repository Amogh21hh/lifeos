"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, Check, Clock, ExternalLink, FileBarChart2, Gauge, Loader2, Network, Scale, ShieldAlert, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { OpportunityRoute, PlanStep, Provenance, ResultBlock, SearchResult } from "@/lib/types";
import { cn } from "@/lib/cn";
import { money, shortDate } from "@/lib/format";
import { apiFetch } from "@/lib/client-api";
import { Badge, Button } from "@/components/ui/primitives";
import { EntityIcon, EntityLink } from "./entity";
import { InsightCard } from "./insight-card";
import { ConfidenceMeter, ProvenanceTag } from "./provenance";
import { SimulationView } from "./simulation-view";

/* ───────────── Approval (PROPOSE → EXPLAIN → ASK → EXECUTE) ───────────── */

export function ApprovalCard({ approvalId, title, explanation, risk, tool, initialStatus = "pending", payload }: { approvalId: string; title: string; explanation: string; risk: string; tool: string; initialStatus?: string; payload?: Record<string, unknown> }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const router = useRouter();
  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    try {
      const res = await apiFetch<{ status: string; error?: string }>(`/api/approvals/${approvalId}`, { body: { decision } });
      setStatus(res.status);
      toast[res.status === "failed" ? "error" : "success"](res.status === "executed" ? "Approved and executed." : res.status === "rejected" ? "Rejected — nothing was changed." : `Status: ${res.status}`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const riskTone = risk === "high" ? "danger" : risk === "medium" ? "signal" : "neutral";
  const body = typeof payload?.body === "string" ? (payload.body as string) : null;
  return (
    <div className={cn("rounded-xl border bg-elev p-4", status === "pending" ? "border-signal/40 shadow-[0_0_0_3px_var(--signal-soft)]" : "border-line")}>
      <div className="flex items-start gap-3">
        <ShieldAlert className={cn("mt-0.5 size-4 shrink-0", status === "pending" ? "text-signal" : "text-faint")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">{title}</span>
            <Badge tone={riskTone}>{risk} risk</Badge>
            <Badge className="font-mono">{tool}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted">{explanation}</p>
          {body && <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-sunken p-2.5 font-sans text-xs whitespace-pre-wrap text-fg/90">{body}</pre>}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status === "pending" ? (
              <>
                <Button size="sm" variant="primary" onClick={() => decide("approve")} disabled={!!busy}>
                  {busy === "approve" ? <Loader2 className="animate-spin" /> : <Check />} Approve & run
                </Button>
                <Button size="sm" variant="ghost" onClick={() => decide("reject")} disabled={!!busy}>
                  {busy === "reject" ? <Loader2 className="animate-spin" /> : <X />} Reject
                </Button>
                <span className="text-[11px] text-faint">Nothing happens until you approve.</span>
              </>
            ) : (
              <Badge tone={status === "executed" ? "success" : status === "rejected" ? "neutral" : "danger"}>{status}</Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────── Plans ───────────── */

export function PlanSteps({ steps, rationale }: { steps: PlanStep[]; rationale?: string }) {
  return (
    <div>
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={i} className={cn("rounded-xl border bg-elev p-3.5", i === 0 ? "border-accent/40 shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line")}>
            <div className="flex items-start gap-3">
              <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md font-mono text-xs font-semibold", i === 0 ? "bg-accent text-accent-fg" : "border border-line bg-sunken text-fg")}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-fg">{s.title}</span>
                  {i === 0 && <Badge tone="accent">smallest useful next action</Badge>}
                  {s.minutes ? (
                    <Badge>
                      <Clock /> {s.minutes} min
                    </Badge>
                  ) : null}
                  {s.kind && s.kind !== "do" && <Badge tone="signal">{s.kind}</Badge>}
                </div>
                <p className="mt-1 text-sm text-muted">{s.detail}</p>
                <p className="mt-1 text-xs text-faint">
                  <span className="font-medium">Why: </span>
                  {s.why}
                </p>
                {s.refs && s.refs.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-2 text-xs">
                    {s.refs.map((r) => (
                      <EntityLink key={`${r.type}${r.id}`} entity={r} className="text-muted" />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {rationale && <p className="mt-3 text-xs text-faint">{rationale}</p>}
    </div>
  );
}

/* ───────────── Search ───────────── */

function SignalBar({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1" title={`${label}: ${value}`}>
      <span className="text-[10px] text-faint">{label}</span>
      <span className="h-1 w-8 overflow-hidden rounded bg-sunken">
        <span className="block h-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
      </span>
    </span>
  );
}

export function SearchResults({ results }: { results: SearchResult[] }) {
  if (!results.length) return <p className="text-sm text-muted">No results.</p>;
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-elev">
      {results.map((r) => (
        <li key={`${r.ref.type}:${r.ref.id}`} className="px-4 py-3 transition-colors hover:bg-hover/50">
          <div className="flex items-start justify-between gap-3">
            <EntityLink entity={r.ref} showType className="text-sm font-medium" />
            <span className="shrink-0 font-mono text-[11px] text-faint">{r.score.toFixed(2)}</span>
          </div>
          <p
            className="mt-1 line-clamp-2 text-sm text-muted [&_b]:text-fg"
            dangerouslySetInnerHTML={{ __html: escapeHtml(r.snippet).replace(/«/g, '<mark class="lifeos-hl">').replace(/»/g, "</mark>") }}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {r.reasons.map((reason, i) => (
              <span key={i} className="text-[11px] text-accent/90">
                ✓ {reason}
              </span>
            ))}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-3">
            <SignalBar label="kw" value={r.signals.keyword} />
            <SignalBar label="sem" value={r.signals.semantic} />
            <SignalBar label="meta" value={r.signals.metadata} />
            <SignalBar label="graph" value={r.signals.graph} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Snippets come from our own index; escape everything, then re-insert only our highlight markers. */
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/* ───────────── Opportunity routes ───────────── */

export function RouteCard({ route, index }: { route: OpportunityRoute; index: number }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <div className={cn("rounded-xl border bg-elev", route.kind === "inferred" ? "border-dashed border-signal/40" : "border-line")}>
      <button type="button" className="flex w-full items-start gap-3 px-4 py-3.5 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-sunken font-mono text-xs">{String.fromCharCode(65 + index)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">{route.title}</span>
            {route.kind === "inferred" && (
              <Badge tone="signal">
                <Sparkles /> inferred
              </Badge>
            )}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
            <Metric label="Upside" value={route.upside ? `${money(route.upside.low)}${route.upside.high !== route.upside.low ? `–${money(route.upside.high)}` : ""}${route.upside.period}` : "—"} p={route.upside?.provenance} />
            <Metric label="Time" value={route.timeHours ? `${route.timeHours.value}h` : "—"} p={route.timeHours?.provenance} />
            <Metric label="Cost" value={route.cost ? money(route.cost.value) : "—"} p={route.cost?.provenance} />
            <Metric label="Deadline" value={route.deadline ? shortDate(route.deadline) : "—"} p={route.deadline ? "fact" : undefined} />
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-lg font-semibold text-accent">{Math.round(route.fitScore * 100)}</div>
          <div className="text-[10px] text-faint">fit</div>
        </div>
      </button>
      {open && (
        <div className="animate-fade-in space-y-3 border-t border-line px-4 py-3.5 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <ConfidenceMeter level={route.confidence} score={route.confidenceScore} />
            {route.difficulty && <span className="text-xs text-muted">Difficulty {route.difficulty}/5</span>}
            <span className="text-xs text-muted">{route.expectedValueNote}</span>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Why it fits</div>
            <ul className="space-y-1">
              {route.whyItFits.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <ProvenanceTag p={e.provenance} className="mt-0.5" />
                  <span className="text-fg/90">{e.text}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Skills</div>
              <div className="flex flex-wrap gap-1">
                {route.skillsMatched.map((s) => (
                  <Badge key={s} tone="success">
                    {s}
                  </Badge>
                ))}
                {route.skillsMissing.map((s) => (
                  <Badge key={s} tone="danger">
                    {s} gap
                  </Badge>
                ))}
                {!route.skillsMatched.length && !route.skillsMissing.length && <span className="text-xs text-faint">None recorded</span>}
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Dependencies</div>
              {route.dependencies.length ? <ul className="list-disc pl-4 text-xs text-muted">{route.dependencies.map((d) => <li key={d}>{d}</li>)}</ul> : <span className="text-xs text-faint">None</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">Assumptions</div>
            <ul className="space-y-0.5 text-xs text-muted">
              {route.assumptions.map((a) => (
                <li key={a} className="flex gap-2">
                  <ProvenanceTag p="assumption" /> {a}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft px-3 py-2">
            <ArrowUpRight className="size-4 text-accent" />
            <span className="text-sm font-medium text-fg">Next action:</span>
            <span className="text-sm text-fg/90">{route.nextAction}</span>
            {route.ref && <EntityLink entity={route.ref} className="ml-auto text-xs text-muted" />}
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, p }: { label: string; value: string; p?: Provenance }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] tracking-wide text-faint uppercase">{label}</div>
      <div className="flex items-center gap-1">
        <span className="truncate font-mono text-fg">{value}</span>
        {p && <ProvenanceTag p={p} />}
      </div>
    </div>
  );
}

/* ───────────── Generic block renderer (Command Center, agent output) ───────────── */

export function ResultBlocks({ blocks }: { blocks: ResultBlock[] }) {
  return (
    <div className="space-y-4">
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

function BlockTitle({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return <h3 className="mb-2 flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase [&_svg]:size-3.5">{icon}{children}</h3>;
}

function BlockView({ block }: { block: ResultBlock }) {
  switch (block.type) {
    case "text":
      return (
        <div>
          {block.title && <BlockTitle>{block.title}</BlockTitle>}
          <div className="rounded-xl border border-line bg-elev px-4 py-3 text-sm whitespace-pre-wrap text-fg/90">{block.body}</div>
        </div>
      );
    case "insights":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          <div className="space-y-2">
            {block.items.length ? block.items.map((it, i) => <InsightCard key={it.key} item={it} defaultOpen={block.items.length === 1 || (i === 0 && block.title === "Explanation")} />) : <p className="text-sm text-muted">Nothing found — that's good news.</p>}
          </div>
        </div>
      );
    case "entities":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-elev">
            {block.items.length === 0 && <li className="px-4 py-3 text-sm text-muted">None.</li>}
            {block.items.map((e, i) => (
              <li key={`${e.id}-${i}`} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <EntityLink entity={e} className="text-sm" />
                  {e.subtitle && <div className="mt-0.5 truncate text-xs text-faint">{e.subtitle}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {e.reason && <Badge tone="signal">{e.reason}</Badge>}
                  {e.meta && <span className="font-mono text-xs text-muted">{e.meta}</span>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      );
    case "search":
      return (
        <div>
          <BlockTitle icon={<Network />}>{block.title}</BlockTitle>
          <SearchResults results={block.results} />
        </div>
      );
    case "plan":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          <PlanSteps steps={block.steps} rationale={block.rationale} />
        </div>
      );
    case "approval":
      return <ApprovalCard approvalId={block.approvalId} title={block.title} explanation={block.explanation} risk={block.risk} tool={block.tool} payload={block.payload} />;
    case "metrics":
      return (
        <div>
          <BlockTitle icon={<Gauge />}>{block.title}</BlockTitle>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {block.items.map((m, i) => (
              <div key={i} className="rounded-xl border border-line bg-elev px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[11px] tracking-wide text-muted uppercase">{m.label}</span>
                  <ProvenanceTag p={m.provenance} />
                </div>
                <div className="mt-1 truncate font-mono text-sm text-fg" title={m.value}>
                  {m.value}
                </div>
                {m.hint && <div className="text-[11px] text-faint">{m.hint}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    case "decision":
      return (
        <Link href={`/decisions/${block.decisionId}`} className="flex items-center gap-3 rounded-xl border border-p-ai/40 bg-p-ai/5 px-4 py-3 hover:bg-p-ai/10">
          <Scale className="size-5 text-p-ai" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-fg">{block.title}</div>
            <div className="text-xs text-muted">Open the decision workspace: weights, scenarios, sensitivity and unknowns</div>
          </div>
          <ArrowUpRight className="size-4 text-muted" />
        </Link>
      );
    case "report":
      return (
        <Link href={block.href} className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3 hover:brightness-110">
          <FileBarChart2 className="size-5 text-accent" />
          <div className="min-w-0 flex-1 text-sm font-medium text-fg">{block.title}</div>
          <ArrowUpRight className="size-4 text-muted" />
        </Link>
      );
    case "simulation":
      return <SimulationView initial={block.result} />;
    case "radar":
      return (
        <div>
          <BlockTitle icon={<Sparkles />}>{block.title}</BlockTitle>
          <div className="space-y-2">
            {block.routes.map((r, i) => (
              <RouteCard key={r.id} route={r} index={i} />
            ))}
          </div>
        </div>
      );
    case "memories":
      return (
        <div>
          <BlockTitle>{block.title}</BlockTitle>
          <ul className="space-y-1.5">
            {block.items.map((m) => (
              <li key={m.id} className="flex items-start gap-3 rounded-xl border border-line bg-elev px-4 py-2.5 text-sm">
                <EntityIcon type="memory" className="mt-0.5" />
                <div className="min-w-0 flex-1 text-fg/90">{m.content}</div>
                <div className="shrink-0 text-right text-[11px] text-faint">
                  <div>{m.source.replace("_", " ")}</div>
                  <div className="font-mono">{Math.round(m.confidence * 100)}%</div>
                </div>
              </li>
            ))}
            {!block.items.length && <li className="text-sm text-muted">No memories matched.</li>}
          </ul>
          <Link href="/knowledge?tab=memory" className="mt-2 inline-flex items-center gap-1 text-xs text-accent">
            Inspect & correct memories <ExternalLink className="size-3" />
          </Link>
        </div>
      );
    default:
      return null;
  }
}
