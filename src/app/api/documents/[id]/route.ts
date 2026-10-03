import { and, eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api, ApiError } from "@/server/security/api";
import { getStorage } from "@/server/storage";
import { removeFromIndex } from "@/server/search/indexer";
import { reprocessAsAgent } from "@/server/services/documents";
import type { DocumentKind } from "@/server/documents/extract";

async function own(db: Parameters<Parameters<typeof api>[1]>[0]["db"], userId: string, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new ApiError(400, "Invalid id");
  const [doc] = await db.select().from(s.documents).where(and(eq(s.documents.id, id), eq(s.documents.userId, userId)));
  if (!doc) throw new ApiError(404, "Document not found");
  return doc;
}

/** Raw file. Served as an attachment with nosniff so uploaded content can never execute in our origin. */
export const GET = api({}, async ({ db, user, params, req }) => {
  const doc = await own(db, user.id, params.id);
  const data = await getStorage().get(doc.storageKey);
  const inline = req.nextUrl.searchParams.get("inline") === "1" && (doc.mimeType === "application/pdf" || doc.mimeType.startsWith("image/") || doc.mimeType.startsWith("text/"));
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": doc.mimeType.startsWith("text/") ? "text/plain; charset=utf-8" : doc.mimeType,
      "content-disposition": `${inline ? "inline" : "attachment"}; filename="${doc.filename.replace(/"/g, "")}"`,
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      "cache-control": "private, max-age=60",
    },
  });
});

export const POST = api({ limit: "ai", body: z.object({ action: z.literal("reprocess"), kind: z.string().max(40).optional() }) }, async ({ db, user, params, body }) => {
  await own(db, user.id, params.id);
  const run = await reprocessAsAgent(db, user.id, params.id, body.kind as DocumentKind | undefined);
  return { status: run.status, summary: run.output.summary };
});

export const PATCH = api({ body: z.object({ title: z.string().trim().min(1).max(200) }) }, async ({ db, user, params, body }) => {
  await own(db, user.id, params.id);
  await db.update(s.documents).set({ title: body.title }).where(eq(s.documents.id, params.id));
  return { ok: true };
});

/** User-initiated deletion (explicitly confirmed in the UI). Agents can never call this route. */
export const DELETE = api({}, async ({ db, user, params }) => {
  const doc = await own(db, user.id, params.id);
  await db.delete(s.documents).where(eq(s.documents.id, doc.id));
  await db.delete(s.links).where(and(eq(s.links.userId, user.id), eq(s.links.fromId, doc.id)));
  await removeFromIndex(db, user.id, "document", doc.id);
  await getStorage().delete(doc.storageKey).catch(() => undefined);
  await db.insert(s.activities).values({ userId: user.id, entityType: "document", action: "deleted", summary: `Deleted document “${doc.title}”` });
  return { ok: true };
});
