import { createHash, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { DB } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { indexEntities } from "@/server/search/indexer";
import { logger } from "@/server/observability/logger";
import { extractDocument, type DocumentKind, type ExtractedField, type ExtractionResult } from "./extract";
import { parseFile, sanitizeFilename, ALLOWED } from "./parse";

export type Enhancer = (input: { text: string; filename: string; rules: ExtractionResult; imageBase64?: { mediaType: string; data: string } }) => Promise<ExtractionResult | null>;

export interface IngestInput {
  filename: string;
  buffer: Buffer;
  title?: string;
  forceKind?: DocumentKind;
  uploadedAt?: Date;
}

export interface IngestResult {
  documentId: string;
  duplicate: boolean;
}

/**
 * Full ingestion: validate → store → parse → extract (rules, then optional LLM) → persist fields with
 * source spans → link to known entities → index for search → activity log.
 */
export async function ingestDocument(db: DB, userId: string, input: IngestInput, enhance?: Enhancer): Promise<IngestResult> {
  const filename = sanitizeFilename(input.filename);
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const [dupe] = await db
    .select({ id: s.documents.id })
    .from(s.documents)
    .where(and(eq(s.documents.userId, userId), eq(s.documents.sha256, sha256)));
  if (dupe) return { documentId: dupe.id, duplicate: true };

  const parsed = await parseFile(filename, input.buffer); // throws UploadRejected on invalid files
  const ext = filename.toLowerCase().split(".").pop()!;
  const storageKey = `${userId}/${randomUUID()}`;
  await getStorage().put(storageKey, input.buffer, ALLOWED[ext].mime);

  const [doc] = await db
    .insert(s.documents)
    .values({
      userId,
      title: input.title ?? filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "),
      filename,
      mimeType: ALLOWED[ext].mime,
      sizeBytes: input.buffer.length,
      sha256,
      storageKey,
      status: "processing",
      textContent: parsed.text.slice(0, 500_000),
      pageCount: parsed.pageCount,
      uploadedAt: input.uploadedAt ?? new Date(),
    })
    .returning();

  try {
    await processDocument(db, userId, doc.id, { forceKind: input.forceKind ?? (parsed.family === "image" ? "image" : undefined), enhance, imageBuffer: parsed.family === "image" ? input.buffer : undefined, note: parsed.note });
  } catch (err) {
    logger.error("document.process_failed", err, { documentId: doc.id });
    await db.update(s.documents).set({ status: "failed", error: err instanceof Error ? err.message : String(err) }).where(eq(s.documents.id, doc.id));
  }
  return { documentId: doc.id, duplicate: false };
}

/** (Re)process a stored document. Safe to call repeatedly — replaces non-user-verified fields. */
export async function processDocument(
  db: DB,
  userId: string,
  documentId: string,
  opts: { forceKind?: DocumentKind; enhance?: Enhancer; imageBuffer?: Buffer; note?: string } = {},
) {
  const [doc] = await db.select().from(s.documents).where(and(eq(s.documents.id, documentId), eq(s.documents.userId, userId)));
  if (!doc) throw new Error("Document not found");
  const text = doc.textContent ?? "";
  const skills = await db.select({ name: s.skills.name }).from(s.skills).where(eq(s.skills.userId, userId));
  let result = extractDocument(text, { filename: doc.filename, knownSkills: skills.map((k) => k.name), forceKind: opts.forceKind });
  let method = "rules";

  if (opts.enhance && (text.trim().length > 40 || opts.imageBuffer)) {
    try {
      const enhanced = await opts.enhance({
        text,
        filename: doc.filename,
        rules: result,
        imageBase64: opts.imageBuffer ? { mediaType: doc.mimeType, data: opts.imageBuffer.toString("base64") } : undefined,
      });
      if (enhanced) {
        result = enhanced;
        method = "rules+llm";
      }
    } catch (err) {
      logger.warn("document.enhance_failed", { documentId, error: String(err) });
    }
  }

  await db.delete(s.documentFields).where(and(eq(s.documentFields.documentId, documentId), eq(s.documentFields.verified, false)));
  if (result.fields.length)
    await db.insert(s.documentFields).values(result.fields.map((f: ExtractedField) => ({ ...f, userId, documentId })));

  await db
    .update(s.documents)
    .set({
      kind: result.kind,
      status: "processed",
      summary: result.summary || opts.note || null,
      extractionMethod: method,
      processedAt: new Date(),
      error: null,
    })
    .where(eq(s.documents.id, documentId));

  await autoLink(db, userId, documentId, text);
  await indexEntities(db, userId, "document", [documentId]);
  await db.insert(s.activities).values({
    userId,
    entityType: "document",
    entityId: documentId,
    action: "uploaded",
    summary: `Processed “${doc.title}” as ${result.kind.replace("_", " ")} (${result.fields.length} fields, ${method})`,
    occurredAt: doc.uploadedAt,
  });
  return result;
}

/** Connect a document to companies, people and opportunities it mentions (provenance: document). */
async function autoLink(db: DB, userId: string, documentId: string, text: string) {
  const lower = text.toLowerCase();
  const [companies, people, opps] = await Promise.all([
    db.select({ id: s.companies.id, name: s.companies.name }).from(s.companies).where(eq(s.companies.userId, userId)),
    db.select({ id: s.people.id, name: s.people.name }).from(s.people).where(eq(s.people.userId, userId)),
    db.select({ id: s.opportunities.id, title: s.opportunities.title, companyId: s.opportunities.companyId }).from(s.opportunities).where(eq(s.opportunities.userId, userId)),
  ]);
  const values: (typeof s.links.$inferInsert)[] = [];
  const mentionedCompanies = new Set<string>();
  for (const c of companies) {
    if (c.name.length > 3 && lower.includes(c.name.toLowerCase())) {
      mentionedCompanies.add(c.id);
      values.push({ userId, fromType: "document", fromId: documentId, toType: "company", toId: c.id, relation: "mentions", strength: 0.7, provenance: "document", rationale: `Document text contains “${c.name}”` });
    }
  }
  for (const p of people) {
    if (lower.includes(p.name.toLowerCase()))
      values.push({ userId, fromType: "document", fromId: documentId, toType: "person", toId: p.id, relation: "mentions", strength: 0.7, provenance: "document", rationale: `Document text contains “${p.name}”` });
  }
  for (const o of opps) {
    const titleCore = o.title.split(/[—–-]/).pop()!.trim().toLowerCase();
    if ((o.companyId && mentionedCompanies.has(o.companyId) && titleCore.length > 4 && lower.includes(titleCore)) || lower.includes(o.title.toLowerCase()))
      values.push({ userId, fromType: "document", fromId: documentId, toType: "opportunity", toId: o.id, relation: "evidences", strength: 0.8, provenance: "document", rationale: `Document names the role “${titleCore}” at a linked company` });
  }
  if (values.length) await db.insert(s.links).values(values).onConflictDoNothing();
}
