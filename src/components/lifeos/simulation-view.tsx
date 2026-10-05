"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight, FlaskConical, Loader2 } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import type { SimulationResult } from "@/lib/types";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/client-api";
import { ConfidenceMeter, ProvenanceTag } from "./provenance";

/**
 * Interactive simulation: every assumption is a slider. Moving one re-runs the deterministic model
 * on the server (debounced) — the user sees exactly how each assumption drives the outcome.
 */
export function SimulationView({ initial }: { initial: SimulationResult }) {
  const [result, setResult] = useState(initial);
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const first = useRef(true);
  // Adopt a new initial result when the parent passes one (render-time sync, no effect).
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setResult(initial);
  }

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await apiFetch<{ result: SimulationResult }>("/api/simulate", { body: { question: initial.question, overrides, save: false } });
        setResult(r.result);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [overrides, initial.question]);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-elev">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3.5">
        <FlaskConical className="mt-0.5 size-4 shrink-0 text-p-assumption" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Simulation · {result.scenarioType.replace("_", " ")}</div>
          <div className="mt-1 text-sm font-medium text-fg">{result.headline}</div>
        </div>
        {loading ? <Loader2 className="size-4 animate-spin text-muted" /> : <ConfidenceMeter level={result.confidence} />}
      </div>

      {result.assumptions.length > 0 && (
        <div className="grid gap-3 border-b border-line bg-sunken/40 px-4 py-3.5 sm:grid-cols-2">
          {result.assumptions.map((a) => (
            <label key={a.key} className="block">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-muted">
                  <ProvenanceTag p={a.provenance} /> {a.label}
                </span>
                <span className="font-mono text-fg">
                  {a.unit === "£" ? `£${a.value.toLocaleString("en-GB")}` : `${a.value}${a.unit === "%" ? "%" : ` ${a.unit}`}`}
                </span>
              </div>
              {a.min !== undefined && a.max !== undefined && (
                <input
                  type="range"
                  min={a.min}
                  max={a.max}
                  step={a.step ?? 1}
                  value={overrides[a.key] ?? a.value}
                  onChange={(e) => setOverrides((o) => ({ ...o, [a.key]: Number(e.target.value) }))}
                  className="mt-1.5 w-full accent-[var(--accent)]"
                  aria-label={a.label}
                />
              )}
            </label>
          ))}
        </div>
      )}

      <div className="px-4 py-3.5">
        {result.effects.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="text-left text-[11px] tracking-wide text-faint uppercase">
                  <th className="pb-2 font-medium">Effect</th>
                  <th className="pb-2 font-medium">Before</th>
                  <th className="pb-2 font-medium">After</th>
                  <th className="pb-2 font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {result.effects.map((e, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 text-fg/90">
                      <span className="flex items-center gap-2">
                        <ProvenanceTag p={e.provenance} /> {e.label}
                      </span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted">{e.before}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-fg">{e.after}</td>
                    <td className={cn("py-2 font-mono text-xs", e.direction === "up" ? "text-success" : e.direction === "down" ? "text-danger" : "text-muted")}>
                      <span className="inline-flex items-center gap-1">
                        {e.direction === "up" ? <ArrowUpRight className="size-3" /> : e.direction === "down" ? <ArrowDownRight className="size-3" /> : <ArrowRight className="size-3" />}
                        {e.delta}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {result.timeline && result.timeline.length > 1 && (
          <div className="mt-4">
            <div className="mb-1 text-[11px] text-faint">{result.timelineUnit} — ESTIMATE</div>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={result.timeline} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="var(--text-faint)" fontSize={11} tickLine={false} />
                  <YAxis stroke="var(--text-faint)" fontSize={11} tickLine={false} width={48} />
                  <RTooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="base" name="Current path" stroke="var(--text-faint)" strokeDasharray="4 4" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="scenario" name="Scenario" stroke="var(--accent)" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
          {[
            { title: "Risks", items: result.risks },
            { title: "Second-order effects", items: result.secondOrder },
            { title: "Caveats", items: result.caveats },
          ].map((sec) => (
            <div key={sec.title}>
              <div className="mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{sec.title}</div>
              {sec.items.length ? <ul className="list-disc space-y-1 pl-4 text-muted marker:text-faint">{sec.items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="text-faint">None identified.</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
