import { api, ApiError } from "@/server/security/api";
import { ingestAsAgent } from "@/server/services/documents";
import { MAX_UPLOAD_BYTES, sanitizeFilename } from "@/server/documents/parse";
import type { DocumentKind } from "@/server/documents/extract";

export const maxDuration = 120;

const KINDS = new Set(["job_description", "invoice", "contract", "cv", "bank_statement", "offer_letter", "correspondence", "course", "immigration", "note", "other"]);

export const POST = api({ limit: "upload", rawBody: true }, async ({ db, user, req }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) throw new ApiError(413, "File too large");
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "Expected multipart form data");
  });
  const file = form.get("file");
  if (!(file instanceof File)) throw new ApiError(400, "No file provided");
  const kind = String(form.get("kind") ?? "");
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await ingestAsAgent(db, user.id, { filename: sanitizeFilename(file.name), buffer, forceKind: KINDS.has(kind) ? (kind as DocumentKind) : undefined });
  return result;
});
