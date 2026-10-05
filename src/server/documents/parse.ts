/**
 * Secure file parsing. Files are validated by extension AND magic bytes, size-capped,
 * and parsed with pure-JS libraries — nothing user-supplied is ever executed.
 */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024;

export const ALLOWED: Record<string, { mime: string; family: "pdf" | "docx" | "xlsx" | "csv" | "text" | "image" }> = {
  pdf: { mime: "application/pdf", family: "pdf" },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", family: "docx" },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", family: "xlsx" },
  csv: { mime: "text/csv", family: "csv" },
  txt: { mime: "text/plain", family: "text" },
  md: { mime: "text/markdown", family: "text" },
  png: { mime: "image/png", family: "image" },
  jpg: { mime: "image/jpeg", family: "image" },
  jpeg: { mime: "image/jpeg", family: "image" },
  webp: { mime: "image/webp", family: "image" },
};

export class UploadRejected extends Error {}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "upload";
  return base.replace(/[^\w.\- ()]+/g, "_").replace(/^\.+/, "").slice(0, 120) || "upload";
}

function startsWith(buf: Buffer, bytes: number[]) {
  return bytes.every((b, i) => buf[i] === b);
}

export function validateUpload(filename: string, buf: Buffer) {
  if (buf.length === 0) throw new UploadRejected("File is empty.");
  if (buf.length > MAX_UPLOAD_BYTES) throw new UploadRejected(`File exceeds ${Math.round(MAX_UPLOAD_BYTES / 1048576)} MB limit.`);
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const spec = ALLOWED[ext];
  if (!spec) throw new UploadRejected(`Unsupported file type ".${ext}". Allowed: ${Object.keys(ALLOWED).join(", ")}.`);
  const ok =
    spec.family === "pdf"
      ? startsWith(buf, [0x25, 0x50, 0x44, 0x46])
      : spec.family === "docx" || spec.family === "xlsx"
        ? startsWith(buf, [0x50, 0x4b, 0x03, 0x04])
        : spec.family === "image"
          ? startsWith(buf, [0x89, 0x50, 0x4e, 0x47]) || startsWith(buf, [0xff, 0xd8, 0xff]) || (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && buf.subarray(8, 12).toString() === "WEBP")
          : !buf.subarray(0, 4096).includes(0); // text: no NUL bytes
  if (!ok) throw new UploadRejected("File contents do not match its extension.");
  return spec;
}

export interface ParsedFile {
  text: string;
  pageCount: number | null;
  family: (typeof ALLOWED)[string]["family"];
  note?: string;
}

export async function parseFile(filename: string, buf: Buffer): Promise<ParsedFile> {
  const spec = validateUpload(filename, buf);
  switch (spec.family) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text, totalPages } = await extractText(pdf, { mergePages: true });
      return { text: String(text).replace(/\u0000/g, ""), pageCount: totalPages, family: "pdf" };
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const { value } = await mammoth.extractRawText({ buffer: buf });
      return { text: value, pageCount: null, family: "docx" };
    }
    case "xlsx": {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as unknown as ArrayBuffer);
      const parts: string[] = [];
      wb.eachSheet((sheet) => {
        parts.push(`# Sheet: ${sheet.name}`);
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const values = (row.values as unknown[]).slice(1).map((v) => {
            if (v && typeof v === "object" && "result" in (v as object)) return String((v as { result: unknown }).result);
            if (v instanceof Date) return v.toISOString().slice(0, 10);
            return v == null ? "" : String(v);
          });
          parts.push(values.join(","));
        });
      });
      return { text: parts.join("\n").slice(0, 400_000), pageCount: wb.worksheets.length, family: "xlsx" };
    }
    case "csv": {
      const Papa = (await import("papaparse")).default;
      const raw = buf.toString("utf8");
      const parsed = Papa.parse<string[]>(raw.slice(0, 2_000_000), { skipEmptyLines: true });
      return { text: parsed.data.map((r) => r.join(",")).join("\n"), pageCount: null, family: "csv" };
    }
    case "text":
      return { text: buf.toString("utf8"), pageCount: null, family: "text" };
    case "image":
      return {
        text: "",
        pageCount: 1,
        family: "image",
        note: "Image stored. Text extraction from images requires a vision-capable AI provider (ANTHROPIC_API_KEY).",
      };
  }
}
