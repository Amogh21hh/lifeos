"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowUpRight } from "lucide-react";
import { EntityIcon, entityHref } from "@/components/lifeos/entity";

export interface GraphData {
  nodes: { id: string; type: string; label: string }[];
  edges: { id: string; source: string; target: string; label: string; inferred: boolean }[];
}

const COLUMNS = ["skill", "project", "goal", "opportunity", "company", "person", "document"];
const COLOR: Record<string, string> = { goal: "var(--signal)", project: "var(--accent)", opportunity: "var(--success)", person: "var(--p-user)", skill: "var(--p-estimate)", document: "var(--p-assumption)", company: "var(--text-muted)" };

/** Knowledge graph: columns by entity type (Skill → Project → Goal → Opportunity → Company → Person → Document). */
export function GraphView({ data, focus }: { data: GraphData; focus: string | null }) {
  const [selected, setSelected] = useState<string | null>(focus);
  const neighbourIds = useMemo(() => {
    const s = new Set<string>();
    if (!selected) return s;
    s.add(selected);
    for (const e of data.edges) {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [selected, data.edges]);

  const nodes: Node[] = useMemo(() => {
    const out: Node[] = [];
    COLUMNS.forEach((col, ci) => {
      data.nodes
        .filter((n) => n.type === col)
        .forEach((n, i) => {
          const dim = selected && !neighbourIds.has(n.id);
          out.push({
            id: n.id,
            position: { x: ci * 260, y: i * 64 + (ci % 2) * 24 },
            data: { label: n.label },
            style: {
              background: "var(--bg-elev)",
              color: "var(--text)",
              border: `1px solid ${n.id === selected ? "var(--text)" : COLOR[n.type] ?? "var(--border)"}`,
              borderLeft: `4px solid ${COLOR[n.type] ?? "var(--border)"}`,
              borderRadius: 10,
              fontSize: 12,
              width: 210,
              padding: "6px 10px",
              opacity: dim ? 0.25 : 1,
            },
          });
        });
    });
    return out;
  }, [data.nodes, selected, neighbourIds]);

  const edges: Edge[] = useMemo(
    () =>
      data.edges.map((e) => {
        const lit = selected && (e.source === selected || e.target === selected);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          label: lit ? e.label : undefined,
          animated: !!lit,
          style: { stroke: e.inferred ? "var(--signal)" : lit ? "var(--accent)" : "var(--border-strong)", strokeOpacity: selected && !lit ? 0.1 : 0.7, strokeDasharray: e.inferred ? "4 4" : undefined },
          labelStyle: { fill: "var(--text-muted)", fontSize: 10 },
          labelBgStyle: { fill: "var(--bg-elev)" },
        };
      }),
    [data.edges, selected],
  );

  const sel = data.nodes.find((n) => n.id === selected);
  const conns = selected ? data.edges.filter((e) => e.source === selected || e.target === selected) : [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="h-[640px] overflow-hidden rounded-2xl border border-line bg-sunken">
        <ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} onNodeClick={(_, n) => setSelected(n.id === selected ? null : n.id)} onPaneClick={() => setSelected(null)} nodesDraggable proOptions={{ hideAttribution: true }} colorMode="system">
          <Background color="var(--border)" gap={24} />
          <MiniMap pannable zoomable nodeColor={(n) => COLOR[String(n.id).split(":")[0]] ?? "#888"} maskColor="rgba(0,0,0,0.25)" style={{ background: "var(--bg-elev)" }} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div className="rounded-2xl border border-line bg-elev p-4 xl:max-h-[640px] xl:overflow-y-auto">
        {sel ? (
          <>
            <div className="flex items-center gap-1.5 text-[11px] tracking-wider text-muted uppercase">
              <EntityIcon type={sel.type} /> {sel.type}
            </div>
            <div className="mt-1 font-medium text-fg">{sel.label}</div>
            <Link href={entityHref({ type: sel.type, id: sel.id.split(":")[1] })} className="mt-1 inline-flex items-center gap-1 text-xs text-accent">
              Open <ArrowUpRight className="size-3" />
            </Link>
            <div className="mt-4 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">{conns.length} connections</div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {conns.map((e) => {
                const otherId = e.source === selected ? e.target : e.source;
                const other = data.nodes.find((n) => n.id === otherId);
                if (!other) return null;
                return (
                  <li key={e.id}>
                    <button onClick={() => setSelected(other.id)} className="flex w-full items-center gap-2 text-left hover:text-accent">
                      <span className="w-20 shrink-0 truncate text-[11px] text-faint">{e.label}</span>
                      <EntityIcon type={other.type} />
                      <span className="truncate text-fg">{other.label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <div className="text-sm text-muted">
            <p className="font-medium text-fg">Explore your knowledge graph</p>
            <p className="mt-1">Click any node to light up its connections. Dashed amber edges are AI-inferred; solid edges come from your records.</p>
            <ul className="mt-3 space-y-1">
              {COLUMNS.map((c) => (
                <li key={c} className="flex items-center gap-2 text-xs">
                  <span className="size-2.5 rounded-sm" style={{ background: COLOR[c] }} /> {c} <span className="font-mono text-faint">{data.nodes.filter((n) => n.type === c).length}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
