import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api, ApiError } from "@/server/security/api";
import { CATALOG, syncIntegration, type IntegrationKind } from "@/server/integrations";

export const POST = api({ body: z.object({ action: z.enum(["connect", "disconnect", "sync"]) }) }, async ({ db, user, params, body }) => {
  const entry = CATALOG.find((c) => c.kind === params.kind);
  if (!entry) throw new ApiError(404, "Unknown integration");
  if (body.action === "sync") {
    try {
      return { summary: await syncIntegration(db, user.id, entry.kind as IntegrationKind) };
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
  }
  const status = body.action === "connect" ? "connected" : "disconnected";
  await db
    .insert(s.integrations)
    .values({ userId: user.id, kind: entry.kind, adapter: entry.adapter, status })
    .onConflictDoUpdate({ target: [s.integrations.userId, s.integrations.kind], set: { status } });
  await db.insert(s.activities).values({ userId: user.id, entityType: "integration", action: "updated", summary: `${entry.label} ${status}` });
  const [row] = await db.select().from(s.integrations).where(and(eq(s.integrations.userId, user.id), eq(s.integrations.kind, entry.kind)));
  return { integration: row };
});
