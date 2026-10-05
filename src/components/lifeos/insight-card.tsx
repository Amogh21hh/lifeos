"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Check, ChevronDown, CircleAlert, Eye, Lightbulb, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import type { Insight } from "@/lib/types";
import { cn } from "@/lib/cn";
import { commandHref } from "@/lib/command";
import { apiFetch } from "@/lib/client-api";
import { Button } from "@/components/ui/primitives";
import { ConfidenceMeter, ProvenanceTag } from "./provenance";
import { EntityLink } from "./entity";

const SEVERITY = {
  critical: { icon: CircleAlert, cls: "text-danger", bar: "bg-danger", label: "Critical" },
  important: { icon: AlertTriangle, cls: "text-signal", bar: "bg-signal", label: "Important" },
  watch: { icon: Eye, cls: "text-accent", bar: "bg-accent", label: "Watch" },
  info: { icon: Lightbulb, cls: "text-muted", bar: "bg-line-strong", label: "Info" },
} as const;

/**
 * The universal explainable unit. Collapsed: conclusion. Expanded: evidence (with provenance),
 * assumptions, confidence, score breakdown and what would change the conclusion.
 */
export function InsightCard({ item, rank, defaultOpen = false, dismissible = false, compact = false }: { item: Insight; rank?: number; defaultOpen?: boolean; dismissible?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [hidden, setHidden] = useState(false);
  const router = useRouter();
  const sev = SEVERITY[item.severity ?? "info"];
  const SevIcon = item.kind === "action" ? Sparkles : sev.icon;

  async function setStatus(status: "dismissed" | "acted") {
    setHidden(true);
    try {
      await apiFetch("/api/insights", { body: { key: item.key, status, title: item.title, kind: item.kind } });
      toast.success(status === "dismissed" ? "Dismissed — it won't be shown again unless the evidence changes." : "Marked as done.");
      router.refresh();
    } catch (e) {
      setHidden(false);
      toast.error((e as Error).message);
    }
  }
  if (hidden) return null;

  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-line bg-elev transition-colors hover:border-line-strong", open && "border-line-strong")}>
      <span className={cn("absolute inset-y-0 left-0 w-0.5", sev.bar)} aria-hidden />
      <button type="button" onClick={() => setOpen((o) => !o)} className={cn("flex w-full items-start gap-3 text-left", compact ? "px-3.5 py-3" : "px-4 py-3.5")} aria-expanded={open}>
        {rank !== undefined ? (
          <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-line bg-sunken font-mono text-xs font-semibold text-fg">{rank}</span>
        ) : (
          <SevIcon className={cn("mt-0.5 size-4 shrink-0", sev.cls)} />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-snug font-medium text-fg">{item.title}</div>
          <div className={cn("mt-1 text-sm leading-relaxed text-muted", !open && "line-clamp-2")}>
            <span className="font-medium text-faint">Reason: </span>
            {item.conclusion}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <ConfidenceMeter level={item.confidence} score={item.confidenceScore} />
            {item.score !== undefined && item.kind === "action" && <span className="font-mono text-[11px] text-faint">leverage {item.score.toFixed(2)}</span>}
            <span className="text-[11px] text-faint">{item.evidence.length} evidence</span>
          </div>
        </div>
        <ChevronDown className={cn("mt-1 size-4 shrink-0 text-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="animate-fade-in space-y-4 border-t border-line bg-sunken/50 px-4 py-4 text-sm">
          <section>
            <h4 className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Evidence</h4>
            <ul className="space-y-1.5">
              {item.evidence.map((e, i) => (
                <li key={i} className="flex items-start gap-2">
                  <ProvenanceTag p={e.provenance} className="mt-0.5" />
                  <span className="min-w-0 text-fg/90">
                    {e.text}
                    {e.ref && (
                      <span className="ml-1.5 inline-flex text-xs">
                        <EntityLink entity={e.ref} className="text-muted" />
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {item.scoreBreakdown && item.scoreBreakdown.length > 0 && (
            <section>
              <h4 className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{item.kind === "action" ? "Leverage = impact × urgency × confidence ÷ effort" : "Score components"}</h4>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {item.scoreBreakdown.map((b) => (
                  <div key={b.factor} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-elev px-2.5 py-1.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-fg">{b.factor}</div>
                      <div className="truncate text-[11px] text-faint" title={b.note}>
                        {b.note}
                      </div>
                    </div>
                    <span className="font-mono text-sm text-accent">{b.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <section>
              <h4 className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Assumptions</h4>
              {item.assumptions.length ? (
                <ul className="space-y-1 text-muted">
                  {item.assumptions.map((a, i) => (
                    <li key={i} className="flex gap-2">
                      <ProvenanceTag p="assumption" className="mt-0.5" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-faint">None beyond the recorded data.</p>
              )}
            </section>
            <section>
              <h4 className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">What would change this</h4>
              {item.wouldChange.length ? (
                <ul className="list-disc space-y-1 pl-4 text-muted marker:text-faint">
                  {item.wouldChange.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-faint">Not specified.</p>
              )}
            </section>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {item.actions?.map((a, i) =>
              a.href ? (
                <Link key={i} href={a.href} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:brightness-110">
                  {a.label} <ArrowUpRight className="size-3.5" />
                </Link>
              ) : a.command ? (
                <Link key={i} href={commandHref(a.command)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg hover:brightness-110">
                  {a.label}
                  {a.minutes ? <span className="opacity-70">· {a.minutes}m</span> : null} <ArrowUpRight className="size-3.5" />
                </Link>
              ) : null,
            )}
            {item.refs?.slice(0, 3).map((r) => (
              <EntityLink key={`${r.type}:${r.id}`} entity={r} className="rounded-lg border border-line bg-elev px-2 py-1 text-xs" />
            ))}
            {dismissible && (
              <div className="ml-auto flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setStatus("acted")}>
                  <Check /> Done
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStatus("dismissed")}>
                  <X /> Not relevant
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
