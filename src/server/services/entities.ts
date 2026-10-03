/**
 * User-initiated CRUD. These are direct actions by the signed-in user (not AI), so they don't go
 * through the approval queue — but they're validated against per-type whitelists, scoped to the
 * owner, re-indexed for search and recorded in the activity stream.
 */
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { indexEntities, removeFromIndex } from "@/server/search/indexer";
import type { EntityType } from "@/lib/types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

export const CREATE = {
  task: z.object({ title: z.string().trim().min(1).max(200), projectId: uuid.optional(), goalId: uuid.optional(), dueDate: day.optional(), estimateMinutes: z.number().int().min(1).max(2400).optional(), priority: z.number().int().min(1).max(5).optional() }),
  goal: z.object({ title: z.string().trim().min(1).max(200), category: z.enum(["career", "finance", "learning", "health", "relationships", "personal"]), priority: z.number().int().min(1).max(5).default(3), description: z.string().max(2000).optional(), targetMetric: z.string().max(100).optional(), targetValue: z.number().optional(), currentValue: z.number().optional(), unit: z.string().max(30).optional(), targetDate: day.optional() }),
  project: z.object({ title: z.string().trim().min(1).max(200), goalId: uuid.optional(), description: z.string().max(2000).optional(), dueDate: day.optional(), priority: z.number().int().min(1).max(5).default(3) }),
  opportunity: z.object({ title: z.string().trim().min(1).max(200), type: z.enum(["job", "internship", "freelance", "side_income", "course", "scholarship", "event", "networking", "investment", "grant"]), description: z.string().max(4000).optional(), deadline: day.optional(), valueLow: z.number().optional(), valueHigh: z.number().optional(), valuePeriod: z.enum(["per_year", "per_month", "per_day", "one_off"]).optional(), effortHours: z.number().min(0).max(1000).optional(), location: z.string().max(100).optional() }),
  person: z.object({ name: z.string().trim().min(1).max(120), role: z.string().max(120).optional(), email: z.string().email().optional(), relationship: z.enum(["recruiter", "mentor", "peer", "manager", "client", "friend", "family", "other"]).default("other"), strength: z.number().int().min(1).max(5).default(2), notes: z.string().max(2000).optional() }),
  memory: z.object({ content: z.string().trim().min(3).max(500), category: z.enum(["preference", "fact", "lesson", "constraint", "pattern", "person", "goal"]), importance: z.number().int().min(1).max(5).default(3) }),
  commitment: z.object({ title: z.string().trim().min(1).max(200), toPersonId: uuid.optional(), dueDate: day.optional() }),
  note: z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(20000) }),
  idea: z.object({ title: z.string().trim().min(1).max(200), body: z.string().max(5000).optional() }),
} as const;

export const PATCH = {
  task: z.object({ title: z.string().trim().min(1).max(200).optional(), status: z.enum(["todo", "in_progress", "blocked", "done", "cancelled"]).optional(), dueDate: day.nullable().optional(), estimateMinutes: z.number().int().min(1).max(2400).nullable().optional(), action: z.enum(["postpone"]).optional() }),
  goal: z.object({ status: z.enum(["active", "paused", "achieved", "abandoned"]).optional(), currentValue: z.number().optional(), priority: z.number().int().min(1).max(5).optional(), targetDate: day.nullable().optional() }),
  project: z.object({ status: z.enum(["planning", "active", "blocked", "paused", "done"]).optional(), currentState: z.string().max(1000).optional(), dueDate: day.nullable().optional() }),
  opportunity: z.object({ status: z.enum(["identified", "researching", "preparing", "applied", "interviewing", "offer", "won", "lost", "dismissed"]).optional(), deadline: day.nullable().optional() }),
  person: z.object({ action: z.enum(["contacted"]).optional(), strength: z.number().int().min(1).max(5).optional(), notes: z.string().max(2000).optional() }),
  memory: z.object({ content: z.string().trim().min(3).max(500).optional(), status: z.enum(["active", "disputed", "archived"]).optional(), importance: z.number().int().min(1).max(5).optional(), action: z.enum(["verify"]).optional() }),
  commitment: z.object({ status: z.enum(["open", "done", "broken", "renegotiated"]).optional(), dueDate: day.nullable().optional() }),
  note: z.object({ title: z.string().trim().min(1).max(200).optional(), body: z.string().max(20000).optional() }),
  idea: z.object({ status: z.enum(["raw", "exploring", "parked", "converted"]).optional() }),
} as const;

export type CrudType = keyof typeof CREATE;
export const CRUD_TYPES = Object.keys(CREATE) as CrudType[];

const TABLE = {
  task: s.tasks,
  goal: s.goals,
  project: s.projects,
  opportunity: s.opportunities,
  person: s.people,
  memory: s.memories,
  commitment: s.commitments,
  note: s.notes,
  idea: s.ideas,
} as const;

export async function createEntity(db: DB, userId: string, type: CrudType, raw: unknown) {
  const data = CREATE[type].parse(raw) as Record<string, unknown>;
  const extra: Record<string, unknown> = type === "memory" ? { source: "user_input", confidence: 1, lastVerifiedAt: new Date() } : type === "opportunity" ? { source: "user_input" } : {};
  if (type === "task" && data.projectId && !data.goalId) {
    const [p] = await db.select({ goalId: s.projects.goalId }).from(s.projects).where(and(eq(s.projects.id, data.projectId as string), eq(s.projects.userId, userId)));
    if (!p) throw new Error("Project not found");
    extra.goalId = p.goalId;
  }
  const table = TABLE[type];
  const [row] = (await db.insert(table).values({ ...data, ...extra, userId } as never).returning()) as { id: string; title?: string; name?: string; content?: string }[];
  await db.insert(s.activities).values({ userId, entityType: type, entityId: row.id, action: "created", summary: `Created ${type}: ${row.title ?? row.name ?? row.content?.slice(0, 60)}` });
  await indexEntities(db, userId, type as EntityType, [row.id]);
  return row;
}

export async function patchEntity(db: DB, userId: string, type: CrudType, id: string, raw: unknown) {
  const { action, ...data } = PATCH[type].parse(raw) as Record<string, unknown> & { action?: string };
  const table = TABLE[type];
  const set: Record<string, unknown> = { ...data };
  let summary = `Updated ${type}`;
  if (type === "task") {
    if (data.status === "done") set.completedAt = new Date();
    if (action === "postpone") {
      set.postponedCount = sql`${s.tasks.postponedCount} + 1`;
      set.dueDate = sql`COALESCE(${s.tasks.dueDate}, CURRENT_DATE) + 1`;
      summary = "Postponed task";
    }
    set.updatedAt = new Date();
  }
  if (type === "person" && action === "contacted") {
    set.lastContactAt = new Date();
    summary = "Logged contact";
  }
  if (type === "memory") {
    set.updatedAt = new Date();
    if (action === "verify" || data.content) set.lastVerifiedAt = new Date();
    if (data.content) set.source = "user_input";
  }
  if (type === "goal" || type === "project" || type === "opportunity") set.updatedAt = new Date();
  if (type === "goal" || type === "project") set.lastActivityAt = new Date();
  if (!Object.keys(set).length) return { ok: true };
  const rows = (await db.update(table).set(set as never).where(and(eq(table.id, id), eq(table.userId, userId))).returning()) as { id: string; title?: string; name?: string; content?: string; goalId?: string | null }[];
  if (!rows.length) throw new Error("Not found");
  const r = rows[0];
  const verb = action === "postpone" ? "postponed" : data.status === "done" ? "completed" : data.status ? "status_changed" : action === "contacted" ? "contacted" : "updated";
  await db.insert(s.activities).values({ userId, entityType: type, entityId: id, action: verb, goalId: r.goalId ?? null, summary: `${summary}: ${r.title ?? r.name ?? r.content?.slice(0, 60)}${data.status ? ` → ${data.status}` : ""}` });
  await indexEntities(db, userId, type as EntityType, [id]);
  return r;
}

export async function deleteEntity(db: DB, userId: string, type: CrudType, id: string) {
  const table = TABLE[type];
  const rows = await db.delete(table).where(and(eq(table.id, id), eq(table.userId, userId))).returning({ id: table.id });
  if (!rows.length) throw new Error("Not found");
  await db.delete(s.links).where(and(eq(s.links.userId, userId), sql`(${s.links.fromId} = ${id} OR ${s.links.toId} = ${id})`));
  await removeFromIndex(db, userId, type as EntityType, id);
  await db.insert(s.activities).values({ userId, entityType: type, action: "deleted", summary: `Deleted ${type}` });
  return { ok: true };
}
