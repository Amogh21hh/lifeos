import { cache } from "react";
import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { requireUser } from "@/server/auth/session";
import { loadWorld } from "@/server/engine/world";
import type { Insight } from "@/lib/types";

/** Per-request cached access for server components. */
export const getViewer = cache(async () => {
  const user = await requireUser();
  const db = await getDb();
  return { user, db };
});

export const getWorld = cache(async () => {
  const { user, db } = await getViewer();
  return loadWorld(db, user.id);
});

export const getInsightStatuses = cache(async () => {
  const { user, db } = await getViewer();
  const rows = await db.select({ key: s.insights.key, status: s.insights.status }).from(s.insights).where(and(eq(s.insights.userId, user.id), inArray(s.insights.status, ["dismissed", "acted"])));
  return new Map(rows.map((r) => [r.key, r.status]));
});

/** Remove insights the user dismissed or marked done. */
export async function visible<T extends Insight>(items: T[]): Promise<T[]> {
  const statuses = await getInsightStatuses();
  return items.filter((i) => !statuses.has(i.key));
}

export const getPendingApprovals = cache(async () => {
  const { user, db } = await getViewer();
  const [row] = await db.select({ n: count() }).from(s.approvals).where(and(eq(s.approvals.userId, user.id), eq(s.approvals.status, "pending")));
  return row?.n ?? 0;
});
