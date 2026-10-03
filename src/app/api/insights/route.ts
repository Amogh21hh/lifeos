import { z } from "zod";
import * as s from "@/server/db/schema";
import { api } from "@/server/security/api";

/** Record user feedback on an insight (dismissed / acted / seen). Dismissed keys are hidden from briefings. */
export const POST = api(
  { body: z.object({ key: z.string().min(1).max(300), status: z.enum(["dismissed", "acted", "seen", "new"]), title: z.string().max(300).default(""), kind: z.string().max(40).default("insight") }) },
  async ({ db, user, body }) => {
    await db
      .insert(s.insights)
      .values({ userId: user.id, key: body.key, kind: body.kind, title: body.title, status: body.status, payload: {} })
      .onConflictDoUpdate({ target: [s.insights.userId, s.insights.key], set: { status: body.status, updatedAt: new Date() } });
    await db.insert(s.activities).values({ userId: user.id, entityType: "insight", action: "updated", summary: `Insight ${body.status}: ${body.title}` });
    return { ok: true };
  },
);
