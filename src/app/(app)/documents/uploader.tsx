"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { Select } from "@/components/ui/primitives";

const ACCEPT = ".pdf,.docx,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg,.webp";
const MAX = 10 * 1024 * 1024;

export function Uploader() {
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [kind, setKind] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files)) {
      if (file.size > MAX) {
        toast.error(`${file.name} is larger than 10 MB`);
        continue;
      }
      setBusy(file.name);
      try {
        const form = new FormData();
        form.append("file", file);
        if (kind) form.append("kind", kind);
        const r = await apiFetch<{ documentId: string; duplicate: boolean }>("/api/documents", { form });
        if (r.duplicate) toast.info(`${file.name} was already uploaded`);
        else toast.success(`${file.name} processed`);
        if (files.length === 1) router.push(`/documents/${r.documentId}`);
      } catch (e) {
        toast.error(`${file.name}: ${(e as Error).message}`);
      }
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files);
        }}
        disabled={!!busy}
        className={cn("flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors", drag ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong hover:bg-hover/40")}
      >
        {busy ? <Loader2 className="size-7 animate-spin text-accent" /> : <UploadCloud className="size-7 text-muted" />}
        <span className="text-sm font-medium text-fg">{busy ? `Processing ${busy}…` : "Drop files here or click to choose"}</span>
        <span className="text-xs text-faint">Classified, extracted, linked and indexed automatically</span>
      </button>
      <input ref={input} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <label className="flex items-center gap-2 text-xs text-muted">
        Document type
        <Select value={kind} onChange={(e) => setKind(e.target.value)} className="h-8 text-xs">
          <option value="">Auto-detect</option>
          {["job_description", "invoice", "contract", "cv", "bank_statement", "offer_letter", "correspondence", "course", "immigration", "note", "other"].map((k) => (
            <option key={k} value={k}>
              {k.replace("_", " ")}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}
