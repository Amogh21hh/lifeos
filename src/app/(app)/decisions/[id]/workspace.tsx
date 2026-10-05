"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, CircleHelp, GitBranch, Layers, Loader2, Plus, RotateCcw, Scale, Sigma, Sparkles, Trash2 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import type { DecisionAnalysis } from "@/server/engine/decision";
import type { DecisionModelExtras } from "@/server/db/schema";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { Badge, Button, Card, CardHeader, Input, Select, Textarea } from "@/components/ui/primitives";
import { ConfidenceMeter, ProvenanceTag } from "@/components/lifeos/provenance";
import type { Provenance } from "@/lib/types";

interface Opt {
  id: string;
  label: string;
  upfrontCost: number | null;
  monthlyCost: number | null;
  timeHours: number | null;
}
interface Crit {
  id: string;
  name: string;
  weight: number;
  rationale: string | null;
  goal: string | null;
}
interface Score {
  optionId: string;
  criterionId: string;
  score: number;
  low: number | null;
  high: number | null;
  rationale: string | null;
  provenance: string;
}

export function DecisionWorkspace({ decision, options, criteria, scores, analysis }: { decision: { id: string; status: string; chosenOptionId: string | null; outcome: string | null; lessons: string | null; reviewOn: string | null; model: DecisionModelExtras }; options: Opt[]; criteria: Crit[]; scores: Score[]; analysis: DecisionAnalysis }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [weights, setWeights] = useState(() => Object.fromEntries(criteria.map((c) => [c.id, c.weight])));
  const weightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Re-sync local slider state when the server sends new criteria (render-time, no effect).
  const [seenCriteria, setSeenCriteria] = useState(criteria);
  if (seenCriteria !== criteria) {
    setSeenCriteria(criteria);
    setWeights(Object.fromEntries(criteria.map((c) => [c.id, c.weight])));
  }

  async function patch(body: Record<string, unknown>, ok?: string) {
    try {
      await apiFetch(`/api/decisions/${decision.id}`, { method: "PATCH", body });
      if (ok) toast.success(ok);
      start(() => router.refresh());
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function setWeight(id: string, v: number) {
    const next = { ...weights, [id]: v };
    setWeights(next);
    if (weightTimer.current) clearTimeout(weightTimer.current);
    weightTimer.current = setTimeout(() => patch({ action: "weights", criteria: Object.entries(next).map(([cid, weight]) => ({ id: cid, weight })) }), 300);
  }

  const totalW = Object.values(weights).reduce((a, b) => a + b, 0) || 1;
  const scoreOf = (o: string, c: string) => scores.find((s) => s.optionId === o && s.criterionId === c);
  const chartData = analysis.options.map((o) => ({ name: o.label.length > 24 ? `${o.label.slice(0, 23)}…` : o.label, Pessimistic: o.worst, Base: o.base, Optimistic: o.best }));
  const decided = decision.status === "decided";

  return (
    <div className="space-y-6">
      {/* Summary */}
      <Card className="border-p-ai/30">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start">
          <Scale className="size-5 shrink-0 text-p-ai" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">What the model shows</span>
              <ConfidenceMeter level={analysis.confidence} />
              {pending && <Loader2 className="size-3.5 animate-spin text-muted" />}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-fg">{analysis.summary}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              {analysis.leader && <Badge tone="accent">Base-case leader: {analysis.leader.label}</Badge>}
              {analysis.robustOption && <Badge>Best worst case: {analysis.robustOption.label}</Badge>}
              {analysis.upsideOption && <Badge>Best upside: {analysis.upsideOption.label}</Badge>}
            </div>
            <p className="mt-3 text-[11px] text-faint">This is a model of your stated priorities, not a recommendation. Change the weights or scores and watch what moves.</p>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {/* Weights */}
          <Card>
            <CardHeader title="Objectives & weights" icon={<Sigma />} subtitle="How much each criterion matters to you. Weights are normalised." />
            <div className="space-y-3 px-5 pb-5">
              {criteria.map((c) => (
                <div key={c.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-fg">
                      {c.name} {c.goal && <span className="text-xs text-faint">· protects “{c.goal}”</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="font-mono text-xs text-accent">{Math.round(((weights[c.id] ?? 0) / totalW) * 100)}%</span>
                      {!decided && criteria.length > 1 && (
                        <button onClick={() => patch({ action: "remove_criterion", criterionId: c.id }, "Criterion removed")} className="text-faint hover:text-danger" aria-label={`Remove ${c.name}`}>
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </span>
                  </div>
                  <input type="range" min={0} max={1} step={0.01} value={weights[c.id] ?? 0} onChange={(e) => setWeight(c.id, Number(e.target.value))} disabled={decided} className="mt-1 w-full accent-[var(--accent)]" aria-label={`Weight of ${c.name}`} />
                  {c.rationale && <div className="text-[11px] text-faint">{c.rationale}</div>}
                </div>
              ))}
              {!decided && <AddInline placeholder="Add a criterion (e.g. Commute time)" onAdd={(name) => patch({ action: "add_criterion", name, weight: 0.2 }, "Criterion added")} />}
            </div>
          </Card>

          {/* Score matrix */}
          <Card>
            <CardHeader title="Options × criteria" icon={<Layers />} subtitle="Score 0–10 (higher is better). Ranges feed the pessimistic and optimistic scenarios. Editing a cell marks it USER INPUT." />
            <div className="overflow-x-auto px-5 pb-5">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-faint uppercase">
                    <th className="pb-2 font-medium">Option</th>
                    {criteria.map((c) => (
                      <th key={c.id} className="pb-2 text-center font-medium">
                        {c.name}
                      </th>
                    ))}
                    <th className="pb-2 text-right font-medium">Base</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {options.map((o) => {
                    const res = analysis.options.find((r) => r.optionId === o.id);
                    const isChosen = decision.chosenOptionId === o.id;
                    return (
                      <tr key={o.id} className={cn(isChosen && "bg-success-soft")}>
                        <td className="py-2 pr-3 align-top">
                          <div className="font-medium text-fg">
                            {isChosen && <CheckCircle2 className="mr-1 inline size-3.5 text-success" />}
                            {o.label}
                          </div>
                          <div className="text-[11px] text-faint">
                            {[o.upfrontCost ? `${money(o.upfrontCost)} upfront` : null, o.monthlyCost ? `${money(o.monthlyCost)}/mo` : null, o.timeHours ? `${o.timeHours}h` : null].filter(Boolean).join(" · ")}
                          </div>
                          {!decided && options.length > 2 && (
                            <button onClick={() => patch({ action: "remove_option", optionId: o.id }, "Option removed")} className="mt-1 text-[11px] text-faint hover:text-danger">
                              remove
                            </button>
                          )}
                        </td>
                        {criteria.map((c) => {
                          const s = scoreOf(o.id, c.id);
                          return (
                            <td key={c.id} className="px-1 py-2 text-center align-top">
                              <ScoreCell
                                value={s?.score ?? 5}
                                low={s?.low ?? null}
                                high={s?.high ?? null}
                                provenance={(s?.provenance as Provenance) ?? "assumption"}
                                rationale={s?.rationale ?? null}
                                disabled={decided}
                                onSave={(score) => patch({ action: "score", optionId: o.id, criterionId: c.id, score, low: Math.max(0, score - ((s?.score ?? score) - (s?.low ?? score))), high: Math.min(10, score + ((s?.high ?? score) - (s?.score ?? score))) })}
                              />
                            </td>
                          );
                        })}
                        <td className="py-2 text-right align-top font-mono text-base font-semibold text-fg">
                          {res?.base.toFixed(2)}
                          <div className="text-[10px] font-normal text-faint">#{res?.rankBase}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!decided && <AddInline className="mt-3" placeholder="Add an option (e.g. Wait 3 months)" onAdd={(label) => patch({ action: "add_option", label }, "Option added")} />}
            </div>
          </Card>

          {/* Scenarios */}
          <Card>
            <CardHeader title="Scenario analysis" icon={<GitBranch />} subtitle="Weighted totals using pessimistic, base and optimistic scores." />
            <div className="h-64 px-3 pb-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 6, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="name" stroke="var(--text-faint)" fontSize={11} tickLine={false} interval={0} />
                  <YAxis domain={[0, 10]} stroke="var(--text-faint)" fontSize={11} tickLine={false} />
                  <RTooltip contentStyle={{ background: "var(--bg-elev)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} cursor={{ fill: "var(--bg-hover)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="Pessimistic" fill="var(--danger)" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Base" fill="var(--accent)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="Optimistic" fill="var(--success)" fillOpacity={0.7} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Sensitivity */}
          <Card>
            <CardHeader title="Sensitivity" icon={<AlertTriangle />} subtitle="How the leader's margin changes when each weight moves ±50%, and the weight at which the leader flips." />
            <div className="space-y-2.5 px-5 pb-5">
              {analysis.sensitivity.map((s) => {
                const max = Math.max(...analysis.sensitivity.map((x) => Math.max(Math.abs(x.marginLow), Math.abs(x.marginHigh))), 0.01);
                return (
                  <div key={s.criterion}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-fg">{s.criterion}</span>
                      <span className="text-xs text-muted">{s.flipAt !== null ? <span className="text-signal">flips to “{s.flipTo}” at weight {s.flipAt}</span> : "never flips within 0–2×"}</span>
                    </div>
                    <div className="relative mt-1 h-2 rounded-full bg-sunken">
                      <div className="absolute top-0 h-2 rounded-full bg-accent/60" style={{ left: `${(Math.min(s.marginLow, s.marginHigh) / max) * 50 + 50}%`, width: `${(Math.abs(s.marginHigh - s.marginLow) / max) * 50}%` }} />
                      <div className="absolute top-[-2px] left-1/2 h-3 w-px bg-line-strong" />
                    </div>
                    <div className="mt-0.5 flex justify-between font-mono text-[10px] text-faint">
                      <span>−50% weight: margin {s.marginLow}</span>
                      <span>+50% weight: margin {s.marginHigh}</span>
                    </div>
                  </div>
                );
              })}
              {analysis.scoreSwings.length > 0 && (
                <div className="mt-3 rounded-lg border border-signal/30 bg-signal-soft p-3 text-sm">
                  <div className="mb-1 text-[11px] font-semibold tracking-wider text-signal uppercase">Fragile scores</div>
                  <ul className="list-disc space-y-1 pl-4 text-fg/90">{analysis.scoreSwings.map((x, i) => <li key={i}>{x.detail}</li>)}</ul>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right rail */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Questions that would change this" icon={<CircleHelp />} />
            <ul className="space-y-3 px-5 pb-5 text-sm">
              {analysis.questions.map((q, i) => (
                <li key={i}>
                  <div className="flex items-start gap-2">
                    <Badge tone={q.impact === "high" ? "danger" : q.impact === "medium" ? "signal" : "neutral"}>{q.impact}</Badge>
                    <span className="text-fg">{q.question}</span>
                  </div>
                  <p className="mt-1 pl-1 text-xs text-muted">{q.why}</p>
                </li>
              ))}
              {!analysis.questions.length && <li className="text-faint">None identified.</li>}
              {!decided && <AddUnknown onAdd={(question, impact) => patch({ action: "add_unknown", question, impact }, "Unknown added")} />}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Missing information" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {analysis.missingInfo.map((m, i) => (
                <li key={i}>
                  <div className="text-fg">{m.item}</div>
                  <div className="text-xs text-muted">{m.why}</div>
                </li>
              ))}
              {!analysis.missingInfo.length && <li className="text-faint">Nothing obvious is missing.</li>}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Facts & context" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {analysis.contextFacts.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <ProvenanceTag p={f.provenance} className="mt-0.5" />
                  <span className="text-fg/90">{f.text}</span>
                </li>
              ))}
              {(decision.model.constraints ?? []).map((c, i) => (
                <li key={`c${i}`} className="flex gap-2">
                  <Badge tone={c.hard ? "danger" : "neutral"}>{c.hard ? "hard" : "soft"} constraint</Badge>
                  <span className="text-fg/90">{c.text}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Second-order effects" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {analysis.secondOrder.map((s, i) => (
                <li key={i} className="flex gap-2">
                  <ProvenanceTag p={(s.provenance as Provenance) ?? "estimate"} className="mt-0.5" />
                  <span className="text-fg/90">
                    {s.text} <span className="text-xs text-faint">({s.horizon})</span>
                  </span>
                </li>
              ))}
              {(decision.model.risks ?? []).map((r, i) => (
                <li key={`r${i}`} className="text-fg/90">
                  <Badge tone="danger">risk</Badge> {r.text} <span className="text-xs text-faint">(p≈{Math.round(r.likelihood * 100)}%, impact {r.impact}/5{r.mitigation ? `; mitigation: ${r.mitigation}` : ""})</span>
                </li>
              ))}
              {!analysis.secondOrder.length && !(decision.model.risks ?? []).length && <li className="text-faint">None identified.</li>}
            </ul>
          </Card>

          {analysis.lessons.length > 0 && (
            <Card>
              <CardHeader title="Lessons from your past decisions" icon={<Sparkles className="text-p-ai" />} />
              <ul className="space-y-2 px-5 pb-5 text-sm">
                {analysis.lessons.map((l, i) => (
                  <li key={i}>
                    <div className="text-fg">“{l.text}”</div>
                    <div className="text-[11px] text-faint">
                      {l.source} · relevance {Math.round(l.similarity * 100)}%
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <CardHeader title="Decision quality checklist" />
            <ul className="space-y-1.5 px-5 pb-5 text-sm">
              {analysis.quality.map((q) => (
                <li key={q.check} className="flex items-start gap-2" title={q.hint}>
                  <span className={cn("mt-1 size-2 shrink-0 rounded-full", q.ok ? "bg-success" : "bg-signal")} />
                  <span className={q.ok ? "text-fg/90" : "text-muted"}>{q.check}</span>
                </li>
              ))}
            </ul>
          </Card>

          <DecideCard decision={decision} options={options} onPatch={patch} />
        </div>
      </div>
    </div>
  );
}

function ScoreCell({ value, low, high, provenance, rationale, disabled, onSave }: { value: number; low: number | null; high: number | null; provenance: Provenance; rationale: string | null; disabled: boolean; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setV(String(value));
  }
  return (
    <div className="flex flex-col items-center gap-0.5" title={rationale ?? undefined}>
      <input
        type="number"
        min={0}
        max={10}
        step={0.5}
        value={v}
        disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (Number.isFinite(n) && n !== value && n >= 0 && n <= 10) onSave(n);
          else setV(String(value));
        }}
        className="h-8 w-14 rounded-md border border-line bg-sunken text-center font-mono text-sm text-fg focus:border-accent/60 focus:outline-none"
        aria-label="Score"
      />
      <span className="font-mono text-[10px] text-faint">{low !== null && high !== null ? `${low}–${high}` : ""}</span>
      <ProvenanceTag p={provenance === ("user_input" as Provenance) ? "user_input" : provenance} className="scale-90" />
    </div>
  );
}

function AddInline({ placeholder, onAdd, className }: { placeholder: string; onAdd: (v: string) => void; className?: string }) {
  const [v, setV] = useState("");
  return (
    <form
      className={cn("flex gap-2", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) {
          onAdd(v.trim());
          setV("");
        }
      }}
    >
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-8 text-xs" maxLength={160} />
      <Button size="sm" type="submit" disabled={!v.trim()}>
        <Plus /> Add
      </Button>
    </form>
  );
}

function AddUnknown({ onAdd }: { onAdd: (q: string, impact: string) => void }) {
  const [q, setQ] = useState("");
  const [impact, setImpact] = useState("medium");
  return (
    <li>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) {
            onAdd(q.trim(), impact);
            setQ("");
          }
        }}
      >
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an unknown…" className="h-8 text-xs" />
        <Select value={impact} onChange={(e) => setImpact(e.target.value)} className="h-8 text-xs" aria-label="Impact">
          <option value="high">high</option>
          <option value="medium">medium</option>
          <option value="low">low</option>
        </Select>
        <Button size="sm" type="submit" aria-label="Add unknown">
          <Plus />
        </Button>
      </form>
    </li>
  );
}

function DecideCard({ decision, options, onPatch }: { decision: { status: string; chosenOptionId: string | null; outcome: string | null; lessons: string | null; reviewOn: string | null }; options: Opt[]; onPatch: (b: Record<string, unknown>, ok?: string) => Promise<void> }) {
  const [choice, setChoice] = useState(options[0]?.id ?? "");
  const [review, setReview] = useState("");
  const [rationale, setRationale] = useState("");
  const [outcome, setOutcome] = useState(decision.outcome ?? "");
  const [lessons, setLessons] = useState(decision.lessons ?? "");
  if (decision.status === "decided") {
    return (
      <Card>
        <CardHeader title="Outcome review" actions={<Button size="sm" variant="ghost" onClick={() => onPatch({ action: "reopen" }, "Decision reopened")}><RotateCcw /> Reopen</Button>} />
        <div className="space-y-2 px-5 pb-5">
          <p className="text-sm text-muted">Chose: <span className="text-fg">{options.find((o) => o.id === decision.chosenOptionId)?.label}</span>{decision.reviewOn && ` · review on ${decision.reviewOn}`}</p>
          <Textarea value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What actually happened?" rows={3} />
          <Textarea value={lessons} onChange={(e) => setLessons(e.target.value)} placeholder="Lesson for next time (saved as a memory)" rows={2} />
          <Button size="sm" variant="primary" onClick={() => onPatch({ action: "outcome", outcome, lessons: lessons || undefined }, "Outcome saved")}>Save review</Button>
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title="Record your decision" />
      <div className="space-y-2 px-5 pb-5">
        <p className="text-xs text-muted">You decide; LIFEOS records it and reminds you to review the outcome.</p>
        <Select value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full" aria-label="Chosen option">
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </Select>
        <Textarea value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Why? (optional)" rows={2} />
        <label className="block text-xs text-muted">
          Review on
          <Input type="date" value={review} onChange={(e) => setReview(e.target.value)} className="mt-1" />
        </label>
        <Button variant="primary" className="w-full" onClick={() => onPatch({ action: "decide", optionId: choice, reviewOn: review || undefined, rationale: rationale || undefined }, "Decision recorded")}>
          <CheckCircle2 /> Record decision
        </Button>
      </div>
    </Card>
  );
}
