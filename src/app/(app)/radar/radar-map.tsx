"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, KeyRound, Lightbulb, Lock, Sparkles, Target, X } from "lucide-react";
import type { PotentialOpportunity, RadarEdge, RadarNode } from "@/server/engine/radar";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/primitives";
import { ProvenanceTag } from "@/components/lifeos/provenance";
import { EntityIcon, EntityLink } from "@/components/lifeos/entity";
import { commandHref } from "@/components/lifeos/insight-card";

const SECTORS = ["goal", "project", "opportunity", "person", "skill", "document", "decision"] as const;
const SECTOR_LABEL: Record<(typeof SECTORS)[number], string> = { goal: "Goals", project: "Projects", opportunity: "Opportunities", person: "People", skill: "Skills", document: "Documents", decision: "Decisions" };
const SECTOR_COLOR: Record<string, string> = { goal: "var(--signal)", project: "var(--accent)", opportunity: "var(--success)", person: "var(--p-user)", skill: "var(--p-estimate)", document: "var(--p-assumption)", decision: "var(--p-ai)", potential: "var(--signal)", user: "var(--accent)" };
const STATUS_RING: Record<string, string> = { healthy: "transparent", attention: "var(--signal)", risk: "var(--danger)", neutral: "transparent" };

const C = 500;
/** Round to 2dp so server and browser trig produce identical SVG attributes (no hydration mismatch). */
const r2 = (n: number) => Math.round(n * 100) / 100;
type Pos = { x: number; y: number; angle: number; r: number };

function layout(nodes: RadarNode[], edges: RadarEdge[]) {
  const pos = new Map<string, Pos>();
  pos.set("user", { x: C, y: C, angle: 0, r: 0 });
  const span = (Math.PI * 2) / SECTORS.length;
  SECTORS.forEach((sector, si) => {
    const items = nodes.filter((n) => n.type === sector).sort((a, b) => b.weight - a.weight);
    const start = si * span - Math.PI / 2 + span * 0.08;
    const usable = span * 0.84;
    items.forEach((n, i) => {
      const angle = start + (items.length === 1 ? usable / 2 : (usable * i) / (items.length - 1));
      const ring = i % 3;
      const r = 230 + ring * 70 + (1 - n.weight) * 40;
      pos.set(n.id, { x: r2(C + Math.cos(angle) * r), y: r2(C + Math.sin(angle) * r), angle, r });
    });
  });
  // Potentials orbit close to the core, at the mean angle of what they connect.
  const potentials = nodes.filter((n) => n.type === "potential");
  potentials.forEach((p, i) => {
    const related = edges.filter((e) => e.from === p.id).map((e) => pos.get(e.to)).filter(Boolean) as Pos[];
    const sx = related.reduce((a, q) => a + Math.cos(q.angle), 0);
    const sy = related.reduce((a, q) => a + Math.sin(q.angle), 0);
    const angle = related.length ? Math.atan2(sy, sx) + (i % 2 ? 0.12 : -0.12) : (i / Math.max(1, potentials.length)) * Math.PI * 2;
    const r = 120 + (i % 3) * 28;
    pos.set(p.id, { x: r2(C + Math.cos(angle) * r), y: r2(C + Math.sin(angle) * r), angle, r });
  });
  return pos;
}

export function RadarMap({ nodes, edges, potentials }: { nodes: RadarNode[]; edges: RadarEdge[]; potentials: PotentialOpportunity[] }) {
  const pos = useMemo(() => layout(nodes, edges), [nodes, edges]);
  const [selected, setSelected] = useState<string | null>(potentials[0]?.id ?? null);
  const [hover, setHover] = useState<string | null>(null);
  const [hiddenSectors, setHidden] = useState<Set<string>>(new Set(["document"]));
  const focus = hover ?? selected;
  const neighbours = useMemo(() => {
    const set = new Set<string>();
    if (!focus) return set;
    set.add(focus);
    for (const e of edges) {
      if (e.from === focus) set.add(e.to);
      if (e.to === focus) set.add(e.from);
    }
    return set;
  }, [focus, edges]);

  const visibleNode = (n: RadarNode) => n.type === "user" || n.type === "potential" || !hiddenSectors.has(n.type);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const selNode = selected ? nodeById.get(selected) : undefined;
  const selPotential = potentials.find((p) => p.id === selected);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
      <div className="relative overflow-hidden rounded-2xl border border-line bg-sunken">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-elev/60 px-3 py-2">
          {SECTORS.map((s) => {
            const off = hiddenSectors.has(s);
            return (
              <button
                key={s}
                onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s)) n.delete(s); else n.add(s); return n; })}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors", off ? "border-line text-faint" : "border-line-strong bg-elev text-fg")}
                aria-pressed={!off}
              >
                <span className="size-2 rounded-full" style={{ background: off ? "var(--border-strong)" : SECTOR_COLOR[s] }} />
                {SECTOR_LABEL[s]} <span className="font-mono text-faint">{nodes.filter((n) => n.type === s).length}</span>
              </button>
            );
          })}
          <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-signal">
            <Sparkles className="size-3.5" /> {potentials.length} potential opportunities
          </span>
        </div>
        <svg viewBox="0 0 1000 1000" className="block aspect-square w-full touch-manipulation select-none" role="img" aria-label="Radar map of goals, projects, opportunities, people, skills, documents and decisions">
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity="0" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.16" />
            </linearGradient>
          </defs>
          {[120, 230, 300, 370, 440].map((r) => (
            <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="var(--border)" strokeDasharray={r === 120 ? "2 6" : undefined} />
          ))}
          {SECTORS.map((s, i) => {
            const a = (i * Math.PI * 2) / SECTORS.length - Math.PI / 2;
            const mid = a + Math.PI / SECTORS.length;
            return (
              <g key={s}>
                <line x1={C} y1={C} x2={r2(C + Math.cos(a) * 470)} y2={r2(C + Math.sin(a) * 470)} stroke="var(--border)" />
                <text x={r2(C + Math.cos(mid) * 482)} y={r2(C + Math.sin(mid) * 482)} textAnchor="middle" dominantBaseline="middle" fontSize="13" letterSpacing="2" fill={hiddenSectors.has(s) ? "var(--text-faint)" : "var(--text-muted)"} className="font-mono uppercase">
                  {SECTOR_LABEL[s]}
                </text>
              </g>
            );
          })}
          <g style={{ transformOrigin: "500px 500px" }} className="animate-sweep">
            <path d={`M ${C} ${C} L ${C + 470} ${C} A 470 470 0 0 0 ${r2(C + 470 * Math.cos(-0.5))} ${r2(C + 470 * Math.sin(-0.5))} Z`} fill="url(#sweep)" />
          </g>
          <circle cx={C} cy={C} r={110} fill="url(#core)" />

          {edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            const na = nodeById.get(e.from);
            const nb = nodeById.get(e.to);
            if (!a || !b || !na || !nb || !visibleNode(na) || !visibleNode(nb)) return null;
            const lit = focus ? neighbours.has(e.from) && neighbours.has(e.to) && (e.from === focus || e.to === focus) : false;
            const mx = r2((a.x + b.x) / 2 + (C - (a.x + b.x) / 2) * 0.25);
            const my = r2((a.y + b.y) / 2 + (C - (a.y + b.y) / 2) * 0.25);
            return (
              <path
                key={i}
                d={`M ${a.x} ${a.y} Q ${mx} ${my} ${b.x} ${b.y}`}
                fill="none"
                stroke={e.inferred ? "var(--signal)" : lit ? "var(--accent)" : "var(--border-strong)"}
                strokeOpacity={focus ? (lit ? 0.95 : 0.12) : e.inferred ? 0.55 : 0.35}
                strokeWidth={lit ? 1.8 : 1}
                strokeDasharray={e.inferred ? "4 4" : e.provenance === "ai_inference" ? "2 3" : undefined}
              />
            );
          })}

          {nodes.filter(visibleNode).map((n) => {
            const p = pos.get(n.id);
            if (!p) return null;
            const size = n.type === "user" ? 26 : n.type === "potential" ? 9 + n.weight * 5 : 5 + n.weight * 8;
            const dim = focus && !neighbours.has(n.id);
            const isSel = selected === n.id;
            const showLabel = n.type === "user" || n.type === "potential" ? false : !focus || neighbours.has(n.id) || n.weight > 0.75;
            const right = p.x >= C;
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                opacity={dim ? 0.25 : 1}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => setSelected(n.id === selected ? null : n.id)}
                role="button"
                aria-label={`${n.type}: ${n.label}`}
              >
                {n.type === "potential" && <circle r={size} fill="var(--signal)" opacity={0.5} className="animate-pulse-ring" style={{ transformOrigin: "center", transformBox: "fill-box" }} />}
                {n.status !== "neutral" && n.status !== "healthy" && <circle r={size + 4} fill="none" stroke={STATUS_RING[n.status]} strokeWidth={1.5} strokeDasharray="3 2" />}
                <circle r={size} fill={n.type === "user" ? "var(--bg-elev)" : SECTOR_COLOR[n.type]} fillOpacity={n.type === "user" ? 1 : 0.9} stroke={isSel ? "var(--text)" : n.type === "user" ? "var(--accent)" : "var(--bg)"} strokeWidth={isSel ? 2.5 : n.type === "user" ? 2 : 1.5} />
                {n.type === "user" && (
                  <text textAnchor="middle" dominantBaseline="central" fontSize="14" fontWeight="600" fill="var(--text)">
                    {n.label.slice(0, 1)}
                  </text>
                )}
                {n.type === "potential" && (
                  <text textAnchor="middle" dominantBaseline="central" fontSize="11" fill="#1a1205" fontWeight="700">
                    ✦
                  </text>
                )}
                {showLabel && (
                  <text x={right ? size + 6 : -size - 6} y={1} textAnchor={right ? "start" : "end"} dominantBaseline="middle" fontSize="12.5" fill="var(--text)" className="pointer-events-none">
                    {n.label.length > 26 ? `${n.label.slice(0, 25)}…` : n.label}
                    {n.sublabel && <tspan fill="var(--text-faint)" fontSize="11">{`  ${n.sublabel.length > 14 ? n.sublabel.slice(0, 13) + "…" : n.sublabel}`}</tspan>}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-elev/60 px-3 py-2 text-[11px] text-faint">
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-dashed border-signal" /> needs attention</span>
          <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-full border border-dashed border-danger" /> at risk</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-px w-5 border-t border-dashed border-signal" /> inferred connection</span>
          <span>Node size = priority / strength / fit</span>
        </div>
      </div>

      <aside className="xl:sticky xl:top-20 xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto">
        {selPotential ? (
          <PotentialPanel p={selPotential} onClose={() => setSelected(null)} nodeById={nodeById} />
        ) : selNode && selNode.type !== "user" ? (
          <div className="rounded-2xl border border-line bg-elev p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] tracking-wider text-muted uppercase">
                  <EntityIcon type={selNode.type} /> {selNode.type}
                </div>
                <h3 className="mt-1 text-lg font-semibold text-fg">{selNode.label}</h3>
                {selNode.sublabel && <div className="text-sm text-muted">{selNode.sublabel}</div>}
              </div>
              <button onClick={() => setSelected(null)} className="rounded-md p-1 text-muted hover:bg-hover" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="mt-4 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Connections</div>
            <ul className="mt-2 space-y-1.5">
              {edges.filter((e) => e.from === selNode.id || e.to === selNode.id).map((e, i) => {
                const other = nodeById.get(e.from === selNode.id ? e.to : e.from);
                if (!other) return null;
                return (
                  <li key={i} className="flex items-center gap-2 text-sm">
                    <span className="w-24 shrink-0 truncate text-xs text-faint">{e.relation}</span>
                    <button onClick={() => setSelected(other.id)} className="flex min-w-0 items-center gap-1.5 text-left text-fg hover:text-accent">
                      <EntityIcon type={other.type} /> <span className="truncate">{other.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selNode.href && (
              <Link href={selNode.href} className="mt-4 inline-flex items-center gap-1 text-sm text-accent">
                Open <ArrowUpRight className="size-3.5" />
              </Link>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-elev p-5">
            <div className="text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">Potential opportunities</div>
            <p className="mt-1 text-sm text-muted">Inferred from patterns across your records. Click one to see the reasoning.</p>
            <ul className="mt-3 space-y-1.5">
              {potentials.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSelected(p.id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-fg hover:bg-hover">
                    <Sparkles className="mt-0.5 size-3.5 shrink-0 text-signal" /> {p.title}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function PotentialPanel({ p, onClose, nodeById }: { p: PotentialOpportunity; onClose: () => void; nodeById: Map<string, RadarNode> }) {
  const sections = [
    { icon: Lightbulb, title: "Why this exists", body: <p className="text-sm leading-relaxed text-fg/90">{p.why}</p> },
    {
      icon: Target,
      title: "What supports it",
      body: (
        <ul className="space-y-1.5">
          {p.supports.map((e, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <ProvenanceTag p={e.provenance} className="mt-0.5" />
              <span className="min-w-0 text-fg/90">
                {e.text} {e.ref && <EntityLink entity={e.ref} className="ml-1 text-xs text-muted" />}
              </span>
            </li>
          ))}
        </ul>
      ),
    },
    { icon: Lock, title: "What is missing", body: <ul className="list-disc space-y-1 pl-4 text-sm text-muted marker:text-faint">{p.missing.map((m) => <li key={m}>{m}</li>)}</ul> },
    { icon: KeyRound, title: "What could unlock it", body: p.unlock.length ? <ul className="list-disc space-y-1 pl-4 text-sm text-muted marker:text-faint">{p.unlock.map((m) => <li key={m}>{m}</li>)}</ul> : <p className="text-sm text-faint">Nothing blocking.</p> },
  ];
  return (
    <div className="animate-fade-in overflow-hidden rounded-2xl border border-signal/40 bg-elev shadow-[0_0_0_4px_var(--signal-soft)]">
      <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] text-signal uppercase">
            <Sparkles className="size-3" /> Potential opportunity · {p.category.replace("_", " ")}
          </div>
          <h3 className="mt-1.5 text-base leading-snug font-semibold text-fg">{p.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={p.confidence >= 0.7 ? "success" : "signal"}>confidence {Math.round(p.confidence * 100)}%</Badge>
            {p.value && <Badge>{p.value}</Badge>}
            <ProvenanceTag p="ai_inference" />
          </div>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-muted hover:bg-hover" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="space-y-4 px-5 py-4">
        {sections.map((s) => (
          <section key={s.title}>
            <h4 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
              <s.icon className="size-3.5" /> {s.title}
            </h4>
            {s.body}
          </section>
        ))}
        <section className="rounded-xl border border-accent/40 bg-accent-soft p-3">
          <h4 className="mb-1 text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">Next action</h4>
          <p className="text-sm text-fg">{p.nextAction}</p>
          <Link href={commandHref(p.nextAction)} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-accent">
            Plan it with the Command Center <ArrowUpRight className="size-3" />
          </Link>
        </section>
        <div className="flex flex-wrap gap-2">
          {p.related.map((id) => {
            const n = nodeById.get(id);
            if (!n?.href) return null;
            return (
              <Link key={id} href={n.href} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-fg">
                <EntityIcon type={n.type} /> {n.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
