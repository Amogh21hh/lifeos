import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { getViewer, getWorld } from "@/server/services/context";
import { PageHeader } from "@/components/ui/primitives";
import { KnowledgeTabs } from "./knowledge-tabs";
import type { GraphData } from "./graph-view";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage(props: PageProps<"/knowledge">) {
  const sp = await props.searchParams;
  const w = await getWorld();
  const { db, user } = await getViewer();
  const noteRows = await db.select().from(s.notes).where(eq(s.notes.userId, user.id)).orderBy(desc(s.notes.createdAt));
  const notes = [
    ...noteRows.map((n) => ({ id: n.id, type: "note" as const, title: n.title, body: n.body, date: n.createdAt.toISOString().slice(0, 10) })),
    ...w.ideas.map((i) => ({ id: i.id, type: "idea" as const, title: i.title, body: i.body ?? "", status: i.status, date: i.createdAt.toISOString().slice(0, 10) })),
  ];

  const nodes: GraphData["nodes"] = [
    ...w.goals.filter((g) => g.status === "active").map((g) => ({ id: `goal:${g.id}`, type: "goal", label: g.title })),
    ...w.projects.filter((p) => p.status !== "done").map((p) => ({ id: `project:${p.id}`, type: "project", label: p.title })),
    ...w.skills.map((k) => ({ id: `skill:${k.id}`, type: "skill", label: `${k.name} ${k.level}/5` })),
    ...w.opportunities.filter((o) => !["lost", "dismissed"].includes(o.status)).map((o) => ({ id: `opportunity:${o.id}`, type: "opportunity", label: o.title.split("—")[0].trim() })),
    ...w.companies.map((c) => ({ id: `company:${c.id}`, type: "company", label: c.name })),
    ...w.people.map((p) => ({ id: `person:${p.id}`, type: "person", label: p.name })),
    ...w.documents.map((d) => ({ id: `document:${d.id}`, type: "document", label: d.title.split("—")[0].trim() })),
  ];
  const ids = new Set(nodes.map((n) => n.id));
  const edges: GraphData["edges"] = [];
  const push = (a: string, b: string, label: string, inferred = false) => {
    if (ids.has(a) && ids.has(b) && a !== b) edges.push({ id: `${a}>${b}>${label}`, source: a, target: b, label, inferred });
  };
  for (const l of w.links) push(`${l.fromType}:${l.fromId}`, `${l.toType}:${l.toId}`, l.relation.replace("_", " "), l.provenance === "ai_inference");
  for (const p of w.projects) if (p.goalId) push(`project:${p.id}`, `goal:${p.goalId}`, "advances");
  for (const o of w.opportunities) {
    if (o.companyId) push(`opportunity:${o.id}`, `company:${o.companyId}`, "at");
  }
  for (const p of w.people) if (p.companyId) push(`person:${p.id}`, `company:${p.companyId}`, "works at");
  for (const r of w.opportunitySkills) if (r.essential) push(`skill:${r.skillId}`, `opportunity:${r.opportunityId}`, "required by");
  const unique = [...new Map(edges.map((e) => [e.id, e])).values()];

  const memories = w.memories
    .map((m) => ({ id: m.id, content: m.content, category: m.category, source: m.source, confidence: m.confidence, importance: m.importance, status: m.status, createdAt: m.createdAt.toISOString(), lastVerifiedAt: m.lastVerifiedAt?.toISOString() ?? null, sourceRefType: m.sourceRefType, sourceRefId: m.sourceRefId, stale: !m.lastVerifiedAt || w.now.getTime() - m.lastVerifiedAt.getTime() > 90 * 86_400_000 }))
    .sort((a, b) => b.importance - a.importance || b.confidence - a.confidence);

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader eyebrow="Personal knowledge" title="Knowledge" description="Search everything you've told LIFEOS, inspect and correct what it remembers about you, and explore how your world connects." />
      <KnowledgeTabs
        initialTab={typeof sp.tab === "string" ? sp.tab : "search"}
        initialQuery={typeof sp.q === "string" ? sp.q : ""}
        focus={typeof sp.focus === "string" ? sp.focus : null}
        memories={memories}
        graph={{ nodes, edges: unique }}
        notes={notes}
      />
    </div>
  );
}
