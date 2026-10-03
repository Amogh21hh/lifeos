import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api, ApiError } from "@/server/security/api";

/** Correct or verify an extracted field. User corrections are marked method=user and survive re-processing. */
export const PATCH = api({ body: z.object({ value: z.string().max(4000).optional(), verified: z.boolean().optional() }) }, async ({ db, user, params, body }) => {
  const [f] = await db
    .update(s.documentFields)
    .set({ ...(body.value !== undefined ? { value: body.value, method: "user", confidence: 1 } : {}), ...(body.verified !== undefined ? { verified: body.verified } : {}), ...(body.value !== undefined ? { verified: true } : {}) })
    .where(and(eq(s.documentFields.id, params.fieldId), eq(s.documentFields.documentId, params.id), eq(s.documentFields.userId, user.id)))
    .returning();
  if (!f) throw new ApiError(404, "Field not found");
  await db.insert(s.activities).values({ userId: user.id, entityType: "document", entityId: params.id, action: "updated", summary: `${body.value !== undefined ? "Corrected" : "Verified"} field “${f.label}”` });
  return { field: f };
});
