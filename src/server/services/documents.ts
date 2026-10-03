import { z } from "zod";
import type { DB } from "@/server/db/client";
import { defineAgent, runAgent } from "@/server/agents/base";
import { llmDocumentEnhancer } from "@/server/agents/agents";
import { ingestDocument, processDocument } from "@/server/documents/pipeline";
import type { DocumentKind } from "@/server/documents/extract";

/**
 * Document ingestion runs as a DocumentAgent execution so it appears in AI activity with its
 * LLM usage (when an AI provider is configured) and trace.
 */
export async function ingestAsAgent(db: DB, userId: string, file: { filename: string; buffer: Buffer; forceKind?: DocumentKind }) {
  const agent = defineAgent({
    name: "DocumentAgent",
    description: "Extracts structured, source-referenced fields from an uploaded document.",
    responsibilities: ["Parse", "Classify", "Extract fields with source spans", "Link to known entities"],
    input: z.object({ filename: z.string(), sizeBytes: z.number() }),
    tools: [],
    async run(ctx) {
      const res = await ingestDocument(db, userId, { filename: file.filename, buffer: file.buffer, forceKind: file.forceKind }, ctx.llm ? llmDocumentEnhancer(ctx) : undefined);
      ctx.note(res.duplicate ? "Duplicate upload — existing document returned" : `Document ${res.documentId} processed`);
      return { summary: res.duplicate ? "This file was already uploaded." : "Document processed.", blocks: [{ type: "entities", title: "Document", items: [{ type: "document", id: res.documentId, label: file.filename }] }] };
    },
  });
  const run = await runAgent(db, userId, agent, { filename: file.filename, sizeBytes: file.buffer.length }, { intent: "upload_document" });
  if (run.status === "error") throw new Error(run.error ?? "Processing failed");
  const block = (run.output.blocks[0] as { items: { id: string }[] }).items[0];
  return { documentId: block.id, duplicate: run.output.summary.startsWith("This file"), runId: run.runId };
}

export async function reprocessAsAgent(db: DB, userId: string, documentId: string, forceKind?: DocumentKind) {
  const agent = defineAgent({
    name: "DocumentAgent",
    description: "Re-runs extraction on a stored document.",
    responsibilities: ["Re-extract fields"],
    input: z.object({ documentId: z.string().uuid() }),
    tools: [],
    async run(ctx, { documentId: id }) {
      const r = await processDocument(db, userId, id, { forceKind, enhance: ctx.llm ? llmDocumentEnhancer(ctx) : undefined });
      return { summary: `Re-processed as ${r.kind} with ${r.fields.length} fields.`, blocks: [] };
    },
  });
  return runAgent(db, userId, agent, { documentId }, { intent: "reprocess_document" });
}
