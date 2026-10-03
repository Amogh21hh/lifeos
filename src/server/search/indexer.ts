import { and, eq, inArray, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getEmbeddingProvider } from "@/server/ai/embeddings";
import type { EntityType } from "@/lib/types";

interface IndexDoc {
  entityType: EntityType;
  entityId: string;
  title: string;
  body: string;
  meta: Record<string, string | number | boolean | null>;
}

const clip = (t: string | null | undefined, n = 4000) => (t ?? "").slice(0, n);
const join = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");

/** Builds search documents for every indexable entity of a user (optionally one type). */
async function buildDocs(db: DB, userId: string, only?: { type: EntityType; ids: string[] }): Promise<IndexDoc[]> {
  const want = (t: EntityType) => !only || only.type === t;
  const idIn = (col: AnyPgColumn) => (only ? inArray(col, only.ids) : undefined);
  const docs: IndexDoc[] = [];

  const companies = await db.select().from(s.companies).where(eq(s.companies.userId, userId));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  const goals = await db.select().from(s.goals).where(eq(s.goals.userId, userId));
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  if (want("goal"))
    for (const g of goals.filter((g) => !only || only.ids.includes(g.id)))
      docs.push({
        entityType: "goal",
        entityId: g.id,
        title: g.title,
        body: join(g.description, g.category, g.targetMetric && `target: ${g.targetMetric} ${g.targetValue ?? ""} ${g.unit ?? ""}`),
        meta: { status: g.status, category: g.category, priority: g.priority, date: g.targetDate },
      });

  if (want("project")) {
    const rows = await db.select().from(s.projects).where(and(eq(s.projects.userId, userId), idIn(s.projects.id)));
    for (const p of rows)
      docs.push({
        entityType: "project",
        entityId: p.id,
        title: p.title,
        body: join(p.description, p.currentState, p.goalId && `goal: ${goalTitle.get(p.goalId)}`),
        meta: { status: p.status, priority: p.priority, date: p.dueDate },
      });
  }

  if (want("task")) {
    const rows = await db.select().from(s.tasks).where(and(eq(s.tasks.userId, userId), idIn(s.tasks.id)));
    for (const t of rows)
      docs.push({
        entityType: "task",
        entityId: t.id,
        title: t.title,
        body: join(t.description, t.blockedReason && `blocked: ${t.blockedReason}`),
        meta: { status: t.status, priority: t.priority, date: t.dueDate, projectId: t.projectId },
      });
  }

  if (want("person")) {
    const rows = await db.select().from(s.people).where(and(eq(s.people.userId, userId), idIn(s.people.id)));
    for (const p of rows)
      docs.push({
        entityType: "person",
        entityId: p.id,
        title: p.name,
        body: join(p.role, p.companyId && companyName.get(p.companyId), p.relationship, p.notes),
        meta: { relationship: p.relationship, strength: p.strength },
      });
  }

  if (want("company"))
    for (const c of companies.filter((c) => !only || only.ids.includes(c.id)))
      docs.push({ entityType: "company", entityId: c.id, title: c.name, body: join(c.industry, c.location, c.notes), meta: { industry: c.industry } });

  if (want("opportunity")) {
    const rows = await db.select().from(s.opportunities).where(and(eq(s.opportunities.userId, userId), idIn(s.opportunities.id)));
    for (const o of rows)
      docs.push({
        entityType: "opportunity",
        entityId: o.id,
        title: o.title,
        body: join(o.companyId && companyName.get(o.companyId), o.type, o.location, clip(o.description, 2000)),
        meta: { status: o.status, type: o.type, date: o.deadline },
      });
  }

  if (want("document")) {
    const rows = await db.select().from(s.documents).where(and(eq(s.documents.userId, userId), idIn(s.documents.id)));
    for (const d of rows)
      docs.push({
        entityType: "document",
        entityId: d.id,
        title: d.title,
        body: join(d.kind, d.summary, clip(d.textContent, 6000)),
        meta: { kind: d.kind, status: d.status, date: d.uploadedAt.toISOString().slice(0, 10) },
      });
  }

  if (want("skill")) {
    const rows = await db.select().from(s.skills).where(and(eq(s.skills.userId, userId), idIn(s.skills.id)));
    for (const k of rows)
      docs.push({ entityType: "skill", entityId: k.id, title: k.name, body: join(k.category, `level ${k.level}/5`), meta: { level: k.level } });
  }

  if (want("decision")) {
    const rows = await db.select().from(s.decisions).where(and(eq(s.decisions.userId, userId), idIn(s.decisions.id)));
    for (const d of rows)
      docs.push({
        entityType: "decision",
        entityId: d.id,
        title: d.title,
        body: join(d.question, d.context, d.outcome && `outcome: ${d.outcome}`, d.lessons && `lessons: ${d.lessons}`),
        meta: { status: d.status, domain: d.domain, date: d.deadline },
      });
  }

  if (want("memory")) {
    const rows = await db.select().from(s.memories).where(and(eq(s.memories.userId, userId), idIn(s.memories.id)));
    for (const m of rows)
      docs.push({
        entityType: "memory",
        entityId: m.id,
        title: m.content.slice(0, 120),
        body: join(m.content, m.category, `source: ${m.source}`),
        meta: { status: m.status, category: m.category },
      });
  }

  if (want("note")) {
    const rows = await db.select().from(s.notes).where(and(eq(s.notes.userId, userId), idIn(s.notes.id)));
    for (const n of rows) docs.push({ entityType: "note", entityId: n.id, title: n.title, body: clip(n.body), meta: { date: n.createdAt.toISOString().slice(0, 10) } });
  }

  if (want("message")) {
    const rows = await db.select().from(s.messages).where(and(eq(s.messages.userId, userId), idIn(s.messages.id)));
    for (const m of rows)
      docs.push({
        entityType: "message",
        entityId: m.id,
        title: m.subject ?? `${m.channel} message`,
        body: join(m.channel, m.direction === "in" ? "received" : "sent", clip(m.body, 2000)),
        meta: { needsReply: m.needsReply, date: m.occurredAt.toISOString().slice(0, 10) },
      });
  }

  if (want("commitment")) {
    const rows = await db.select().from(s.commitments).where(and(eq(s.commitments.userId, userId), idIn(s.commitments.id)));
    for (const c of rows)
      docs.push({ entityType: "commitment", entityId: c.id, title: c.title, body: join("commitment promise", c.notes), meta: { status: c.status, date: c.dueDate } });
  }

  if (want("idea")) {
    const rows = await db.select().from(s.ideas).where(and(eq(s.ideas.userId, userId), idIn(s.ideas.id)));
    for (const i of rows) docs.push({ entityType: "idea", entityId: i.id, title: i.title, body: clip(i.body), meta: { status: i.status } });
  }

  if (want("event")) {
    const rows = await db.select().from(s.events).where(and(eq(s.events.userId, userId), idIn(s.events.id)));
    for (const e of rows)
      docs.push({ entityType: "event", entityId: e.id, title: e.title, body: join(e.kind, e.location), meta: { date: e.startsAt.toISOString().slice(0, 10), kind: e.kind } });
  }

  if (want("course")) {
    const rows = await db.select().from(s.courses).where(and(eq(s.courses.userId, userId), idIn(s.courses.id)));
    for (const c of rows) docs.push({ entityType: "course", entityId: c.id, title: c.title, body: join(c.provider, "course learning"), meta: { status: c.status } });
  }

  if (want("credential")) {
    const rows = await db.select().from(s.credentials).where(and(eq(s.credentials.userId, userId), idIn(s.credentials.id)));
    for (const c of rows)
      docs.push({ entityType: "credential", entityId: c.id, title: c.name, body: join(c.issuer, c.kind), meta: { status: c.status, date: c.examDate ?? c.expiresAt } });
  }

  return docs;
}

async function upsert(db: DB, userId: string, docs: IndexDoc[]) {
  if (!docs.length) return;
  const provider = getEmbeddingProvider();
  const BATCH = 64;
  for (let i = 0; i < docs.length; i += BATCH) {
    const chunk = docs.slice(i, i + BATCH);
    const vectors = await provider.embed(chunk.map((d) => `${d.title}\n${d.body}`));
    await db
      .insert(s.searchIndex)
      .values(
        chunk.map((d, j) => ({
          userId,
          entityType: d.entityType,
          entityId: d.entityId,
          title: d.title,
          body: d.body,
          meta: d.meta,
          embedding: vectors[j]?.length ? vectors[j] : null,
          updatedAt: new Date(),
        })),
      )
      .onConflictDoUpdate({
        target: [s.searchIndex.userId, s.searchIndex.entityType, s.searchIndex.entityId],
        set: {
          title: sql`excluded.title`,
          body: sql`excluded.body`,
          meta: sql`excluded.meta`,
          embedding: sql`excluded.embedding`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

/** Full re-index for a user. */
export async function reindexUser(db: DB, userId: string) {
  await db.delete(s.searchIndex).where(eq(s.searchIndex.userId, userId));
  const docs = await buildDocs(db, userId);
  await upsert(db, userId, docs);
  return docs.length;
}

/** Incremental index of specific entities after a write. */
export async function indexEntities(db: DB, userId: string, type: EntityType, ids: string[]) {
  if (!ids.length) return;
  const docs = await buildDocs(db, userId, { type, ids });
  await upsert(db, userId, docs);
}

export async function removeFromIndex(db: DB, userId: string, type: EntityType, id: string) {
  await db
    .delete(s.searchIndex)
    .where(and(eq(s.searchIndex.userId, userId), eq(s.searchIndex.entityType, type), eq(s.searchIndex.entityId, id)));
}
