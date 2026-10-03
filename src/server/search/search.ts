/**
 * Personal search engine — hybrid retrieval over everything LIFEOS knows.
 *
 *   keyword   Postgres full-text search (weighted title/body tsvector, OR-query, ts_rank_cd)
 *   semantic  pgvector cosine similarity over entity embeddings
 *   metadata  entity type / status / date filters parsed from the query ("overdue", "documents"…)
 *   graph     1–2 hop expansion from an anchor entity ("connected to Priya", "my Python skills")
 *
 * Every result explains which signals matched and why.
 */
import { sql } from "drizzle-orm";
import { daysUntil } from "@/lib/format";
import type { EntityType, SearchResult } from "@/lib/types";
import { getEmbeddingProvider, stemWord, tokenize } from "@/server/ai/embeddings";
import type { DB } from "@/server/db/client";
import { refOf, type World } from "@/server/engine/world";

const TYPE_WORDS: [RegExp, EntityType[]][] = [
  [/\b(documents?|docs?|files?|uploads?|pdfs?|contracts?|invoices?)\b/i, ["document"]],
  [/\bprojects?\b/i, ["project"]],
  [/\btasks?|to-?dos?\b/i, ["task"]],
  [/\b(people|persons?|contacts?|who)\b/i, ["person"]],
  [/\b(companies|company|employers?|firms?)\b/i, ["company"]],
  [/\b(opportunit(y|ies)|jobs?|roles?|gigs?)\b/i, ["opportunity"]],
  [/\b(decisions?|decide[ds]?)\b/i, ["decision"]],
  [/\b(commitments?|promises?|promised)\b/i, ["commitment"]],
  [/\bgoals?\b/i, ["goal"]],
  [/\b(memor(y|ies)|remember)\b/i, ["memory"]],
  [/\b(messages?|emails?|said|mentioned)\b/i, ["message", "note", "document"]],
  [/\bnotes?\b/i, ["note"]],
  [/\bskills?\b/i, ["skill"]],
];

const FILTER_WORDS = /\b(show|me|find|every|everything|all|which|what|where|did|i|my|are|is|currently|related|connected|to|about|the|that|this|any|list|with|involving)\b/gi;

export interface ParsedQuery {
  text: string;
  types: EntityType[];
  status: "overdue" | "unfinished" | "blocked" | "done" | null;
  anchor: string | null;
  relation: "evidences" | null;
}

export function parseQuery(q: string): ParsedQuery {
  const types = new Set<EntityType>();
  for (const [re, ts] of TYPE_WORDS) if (re.test(q)) ts.forEach((t) => types.add(t));
  let status: ParsedQuery["status"] = null;
  if (/\b(overdue|late|missed|past due)\b/i.test(q)) status = "overdue";
  else if (/\b(unfinished|incomplete|open|in progress|active|pending)\b/i.test(q)) status = "unfinished";
  else if (/\bblocked\b/i.test(q)) status = "blocked";
  else if (/\b(done|finished|completed|decided)\b/i.test(q) && !types.has("decision")) status = "done";
  let anchor: string | null = null;
  const rel = q.match(/\b(?:connected to|related to|linked to|involving|about|with|everything (?:on|about|for))\s+(.+?)\??$/i);
  if (rel) anchor = rel[1].replace(/^(this|the|my)\s+/i, "").trim();
  let relation: ParsedQuery["relation"] = null;
  const demo = q.match(/\b(?:demonstrate|show|prove|evidence)s?\s+(?:my\s+)?(.+?)\s+skills?/i);
  if (demo) {
    anchor = demo[1];
    relation = "evidences";
    types.add("project");
  }
  const text = q
    .replace(FILTER_WORDS, " ")
    .replace(/\b(overdue|unfinished|incomplete|currently|demonstrate|connected|related)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { text, types: [...types], status, anchor, relation };
}

interface Row {
  entity_type: string;
  entity_id: string;
  title: string;
  body: string;
  meta: Record<string, unknown>;
  kw: number;
  sem: number;
  snippet: string | null;
}

/** Undirected neighbourhood via explicit links and structural foreign keys. */
export function neighbours(w: World, type: string, id: string): Map<string, { hop: number; via: string }> {
  const adj = (t: string, i: string): { key: string; via: string }[] => {
    const out: { key: string; via: string }[] = [];
    for (const l of w.links) {
      if (l.fromType === t && l.fromId === i) out.push({ key: `${l.toType}:${l.toId}`, via: l.relation.replace("_", " ") });
      if (l.toType === t && l.toId === i) out.push({ key: `${l.fromType}:${l.fromId}`, via: l.relation.replace("_", " ") });
    }
    if (t === "company") {
      w.people.filter((p) => p.companyId === i).forEach((p) => out.push({ key: `person:${p.id}`, via: "works at" }));
      w.opportunities.filter((o) => o.companyId === i).forEach((o) => out.push({ key: `opportunity:${o.id}`, via: "role at" }));
    }
    if (t === "person") {
      const p = w.idx.person.get(i);
      if (p?.companyId) out.push({ key: `company:${p.companyId}`, via: "works at" });
      w.opportunities.filter((o) => o.contactPersonId === i).forEach((o) => out.push({ key: `opportunity:${o.id}`, via: "contact for" }));
      w.messages.filter((m) => m.personId === i).forEach((m) => out.push({ key: `message:${m.id}`, via: "message" }));
      w.commitments.filter((c) => c.toPersonId === i).forEach((c) => out.push({ key: `commitment:${c.id}`, via: "promise to" }));
      w.events.filter((e) => e.personId === i).forEach((e) => out.push({ key: `event:${e.id}`, via: "meeting" }));
    }
    if (t === "opportunity") {
      const o = w.idx.opportunity.get(i);
      if (o?.companyId) out.push({ key: `company:${o.companyId}`, via: "employer" });
      if (o?.contactPersonId) out.push({ key: `person:${o.contactPersonId}`, via: "contact" });
      w.opportunitySkills.filter((r) => r.opportunityId === i).forEach((r) => out.push({ key: `skill:${r.skillId}`, via: "requires" }));
      w.messages.filter((m) => m.opportunityId === i).forEach((m) => out.push({ key: `message:${m.id}`, via: "message" }));
    }
    if (t === "project") {
      const p = w.idx.project.get(i);
      if (p?.goalId) out.push({ key: `goal:${p.goalId}`, via: "advances" });
      (w.idx.tasksByProject.get(i) ?? []).forEach((x) => out.push({ key: `task:${x.id}`, via: "task" }));
    }
    if (t === "goal") w.projects.filter((p) => p.goalId === i).forEach((p) => out.push({ key: `project:${p.id}`, via: "project" }));
    if (t === "skill") w.opportunitySkills.filter((r) => r.skillId === i).forEach((r) => out.push({ key: `opportunity:${r.opportunityId}`, via: "required by" }));
    return out;
  };
  const result = new Map<string, { hop: number; via: string }>();
  for (const n of adj(type, id)) if (!result.has(n.key)) result.set(n.key, { hop: 1, via: n.via });
  for (const [key, v] of [...result]) {
    if (v.hop !== 1) continue;
    const [t2, i2] = key.split(":");
    for (const n of adj(t2, i2)) if (!result.has(n.key) && n.key !== `${type}:${id}`) result.set(n.key, { hop: 2, via: `${v.via} → ${n.via}` });
  }
  return result;
}

function findAnchor(w: World, text: string): { type: EntityType; id: string; label: string } | null {
  const t = text.toLowerCase().replace(/[?.!]/g, "").trim();
  if (!t) return null;
  const pools: [EntityType, { id: string; name: string }[]][] = [
    ["person", w.people.map((p) => ({ id: p.id, name: p.name }))],
    ["company", w.companies.map((c) => ({ id: c.id, name: c.name }))],
    ["skill", w.skills.map((k) => ({ id: k.id, name: k.name }))],
    ["project", w.projects.map((p) => ({ id: p.id, name: p.title }))],
    ["goal", w.goals.map((g) => ({ id: g.id, name: g.title }))],
    ["opportunity", w.opportunities.map((o) => ({ id: o.id, name: o.title }))],
  ];
  for (const [type, items] of pools) {
    const exact = items.find((x) => x.name.toLowerCase() === t);
    if (exact) return { type, id: exact.id, label: exact.name };
  }
  for (const [type, items] of pools) {
    const partial = items.find((x) => x.name.toLowerCase().includes(t) || t.includes(x.name.toLowerCase()) || x.name.toLowerCase().split(/\s+/).some((p) => p.length > 3 && t.split(/\s+/).includes(p)));
    if (partial) return { type, id: partial.id, label: partial.name };
  }
  return null;
}

function statusMatches(w: World, type: string, id: string, status: ParsedQuery["status"]): string | null {
  if (!status) return null;
  const today = (d: string | null) => daysUntil(d, w.now);
  switch (type) {
    case "task": {
      const t = w.idx.task.get(id);
      if (!t) return null;
      if (status === "overdue" && t.status !== "done" && (today(t.dueDate) ?? 1) < 0) return `overdue since ${t.dueDate}`;
      if (status === "unfinished" && !["done", "cancelled"].includes(t.status)) return `status ${t.status}`;
      if (status === "blocked" && t.status === "blocked") return "blocked";
      if (status === "done" && t.status === "done") return "completed";
      return null;
    }
    case "commitment": {
      const c = w.commitments.find((x) => x.id === id);
      if (!c) return null;
      if (status === "overdue" && c.status === "open" && (today(c.dueDate) ?? 1) < 0) return `promised for ${c.dueDate}`;
      if (status === "unfinished" && c.status === "open") return "open";
      if (status === "done" && c.status === "done") return "kept";
      return null;
    }
    case "project": {
      const p = w.idx.project.get(id);
      if (!p) return null;
      if (status === "unfinished" && p.status !== "done") return `status ${p.status}`;
      if (status === "blocked" && p.status === "blocked") return "blocked";
      if (status === "overdue" && p.status !== "done" && (today(p.dueDate) ?? 1) < 0) return "past due date";
      if (status === "done" && p.status === "done") return "done";
      return null;
    }
    case "opportunity": {
      const o = w.idx.opportunity.get(id);
      if (!o) return null;
      if (status === "overdue" && ["identified", "researching", "preparing"].includes(o.status) && (today(o.deadline) ?? 1) < 0) return "deadline passed";
      if (status === "unfinished" && !["won", "lost", "dismissed"].includes(o.status)) return `status ${o.status}`;
      return null;
    }
    case "decision": {
      const d = w.idx.decision.get(id);
      if (!d) return null;
      if (status === "unfinished" && d.status !== "decided") return "undecided";
      if (status === "done" && d.status === "decided") return "decided";
      return null;
    }
    default:
      return null;
  }
}

export async function hybridSearch(db: DB, w: World, query: string, opts: { limit?: number } = {}): Promise<{ parsed: ParsedQuery; anchor: ReturnType<typeof findAnchor>; results: SearchResult[] }> {
  const parsed = parseQuery(query);
  const limit = opts.limit ?? 20;
  const terms = [...new Set(tokenize(parsed.text || query).map((t) => t.replace(/[^a-z0-9]/g, "")).filter((t) => t.length > 1))];
  const tsQuery = terms.map((t) => `${t}:*`).join(" | ");
  const [qv] = await getEmbeddingProvider().embed([query]);
  const hasVec = !!qv?.length;
  const vecLiteral = hasVec ? `[${qv.join(",")}]` : null;

  const rowsRes = await db.execute(sql`
    WITH q AS (SELECT ${tsQuery ? sql`to_tsquery('english', ${tsQuery})` : sql`NULL::tsquery`} AS tsq)
    SELECT s.entity_type, s.entity_id::text AS entity_id, s.title, s.body, s.meta,
      COALESCE(CASE WHEN q.tsq IS NULL THEN 0 ELSE ts_rank_cd(s.tsv, q.tsq, 32) END, 0)::float AS kw,
      ${hasVec ? sql`COALESCE(1 - (s.embedding <=> ${vecLiteral}::vector), 0)::float` : sql`0::float`} AS sem,
      CASE WHEN q.tsq IS NOT NULL AND s.tsv @@ q.tsq
        THEN ts_headline('english', s.title || ' — ' || left(s.body, 4000), q.tsq, 'MaxFragments=1,MaxWords=28,MinWords=8,StartSel=«,StopSel=»')
        ELSE NULL END AS snippet
    FROM search_index s, q
    WHERE s.user_id = ${w.user.id}
      AND (${tsQuery ? sql`s.tsv @@ q.tsq OR ` : sql``} ${hasVec ? sql`(1 - (s.embedding <=> ${vecLiteral}::vector)) > 0.12` : sql`FALSE`})
    ORDER BY kw DESC, sem DESC
    LIMIT 80
  `);
  const rows = (rowsRes as unknown as { rows: Row[] }).rows;

  const anchorEntity = parsed.anchor ? findAnchor(w, parsed.anchor) : null;
  const graph = anchorEntity ? neighbours(w, anchorEntity.type, anchorEntity.id) : new Map();

  const byKey = new Map<string, SearchResult>();
  const maxKw = Math.max(0.0001, ...rows.map((r) => r.kw));
  const stems = terms.map(stemWord);

  for (const r of rows) {
    const key = `${r.entity_type}:${r.entity_id}`;
    const kwNorm = r.kw / maxKw;
    const reasons: string[] = [];
    if (r.kw > 0) {
      const hit = stems.filter((t) => `${r.title} ${r.body}`.toLowerCase().includes(t));
      reasons.push(`Keyword match: ${hit.slice(0, 4).map((h) => `“${h}”`).join(", ") || "query terms"}${stems.some((t) => r.title.toLowerCase().includes(t)) ? " (in title)" : ""}`);
    }
    if (r.sem > 0.25) reasons.push(`Semantically similar (${Math.round(r.sem * 100)}%)`);
    let metadata = 0;
    if (parsed.types.length) {
      if (parsed.types.includes(r.entity_type as EntityType)) {
        metadata += 0.3;
        reasons.push(`Type: ${r.entity_type}`);
      } else metadata -= 0.35;
    }
    const st = statusMatches(w, r.entity_type, r.entity_id, parsed.status);
    if (parsed.status) {
      if (st) {
        metadata += 0.45;
        reasons.push(`Status: ${st}`);
      } else metadata -= 0.4;
    }
    let graphScore = 0;
    const g = graph.get(key);
    if (g) {
      graphScore = g.hop === 1 ? 0.6 : 0.3;
      reasons.push(`Connected to ${anchorEntity!.label} (${g.via})`);
    }
    if (parsed.relation === "evidences" && anchorEntity?.type === "skill") {
      const ev = w.links.some((l) => l.relation === "evidences" && l.fromId === r.entity_id && l.toId === anchorEntity.id);
      if (ev) {
        graphScore += 0.8;
        reasons.push(`Evidences ${anchorEntity.label}`);
      } else if (r.entity_type === "project") graphScore -= 0.3;
    }
    const score = 0.45 * kwNorm + 0.4 * Math.max(0, r.sem) + metadata + graphScore;
    byKey.set(key, {
      ref: refOf(w, r.entity_type as EntityType, r.entity_id),
      snippet: r.snippet ?? `${r.body.slice(0, 180)}${r.body.length > 180 ? "…" : ""}`,
      score: Number(score.toFixed(3)),
      reasons,
      signals: { keyword: Number(kwNorm.toFixed(2)), semantic: Number(Math.max(0, r.sem).toFixed(2)), metadata: Number(metadata.toFixed(2)), graph: Number(graphScore.toFixed(2)) },
    });
    if (byKey.get(key)!.ref.label === r.entity_type) byKey.get(key)!.ref.label = r.title;
  }

  // Graph-only and status-only results that text retrieval didn't surface.
  if (anchorEntity) {
    for (const [key, g] of graph) {
      if (byKey.has(key)) continue;
      const [type, id] = key.split(":");
      if (parsed.types.length && !parsed.types.includes(type as EntityType)) continue;
      if (parsed.relation === "evidences") continue;
      const ref = refOf(w, type as EntityType, id);
      byKey.set(key, { ref, snippet: `${g.hop === 1 ? "Directly" : "Indirectly"} connected via ${g.via}`, score: g.hop === 1 ? 0.6 : 0.3, reasons: [`Connected to ${anchorEntity.label} (${g.via})`], signals: { keyword: 0, semantic: 0, metadata: 0, graph: g.hop === 1 ? 0.6 : 0.3 } });
    }
    if (parsed.relation === "evidences" && anchorEntity.type === "skill") {
      for (const l of w.links.filter((l) => l.relation === "evidences" && l.toId === anchorEntity.id && l.fromType === "project")) {
        const key = `project:${l.fromId}`;
        if (byKey.has(key)) continue;
        byKey.set(key, { ref: refOf(w, "project", l.fromId), snippet: l.rationale ?? `Evidences ${anchorEntity.label}`, score: 0.9, reasons: [`Evidences ${anchorEntity.label}`], signals: { keyword: 0, semantic: 0, metadata: 0.1, graph: 0.8 } });
      }
    }
  }
  if (parsed.status) {
    const pool: [EntityType, string][] = [
      ...w.tasks.map((t) => ["task", t.id] as [EntityType, string]),
      ...w.commitments.map((c) => ["commitment", c.id] as [EntityType, string]),
      ...w.projects.map((p) => ["project", p.id] as [EntityType, string]),
      ...w.opportunities.map((o) => ["opportunity", o.id] as [EntityType, string]),
      ...w.decisions.map((d) => ["decision", d.id] as [EntityType, string]),
    ];
    for (const [type, id] of pool) {
      const key = `${type}:${id}`;
      if (byKey.has(key)) continue;
      if (parsed.types.length && !parsed.types.includes(type)) continue;
      const st = statusMatches(w, type, id, parsed.status);
      if (!st) continue;
      if (terms.length && !parsed.types.length && !anchorEntity) continue; // text query w/o type: rely on text retrieval
      byKey.set(key, { ref: refOf(w, type, id), snippet: `Matched by status filter: ${st}`, score: 0.55, reasons: [`Status: ${st}`], signals: { keyword: 0, semantic: 0, metadata: 0.55, graph: 0 } });
    }
  }

  const results = [...byKey.values()]
    .filter((r) => r.score > 0.08)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return { parsed, anchor: anchorEntity, results };
}
