"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Download, FolderPlus, ListPlus, Loader2, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Textarea } from "@/components/ui/primitives";
import { EntityLink } from "@/components/lifeos/entity";
import { ProvenanceTag } from "@/components/lifeos/provenance";
import { commandHref } from "@/components/lifeos/insight-card";
import type { EntityRef } from "@/lib/types";

interface Field {
  id: string;
  key: string;
  label: string;
  value: string;
  valueType: string;
  confidence: number;
  sourceText: string | null;
  sourceStart: number | null;
  sourceEnd: number | null;
  method: string;
  verified: boolean;
}

export function DocumentView({ doc, fields, links }: { doc: { id: string; title: string; filename: string; mimeType: string; kind: string; text: string }; fields: Field[]; links: { relation: string; rationale: string | null; ref: EntityRef }[] }) {
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const router = useRouter();
  const textRef = useRef<HTMLDivElement>(null);

  // Build highlighted segments from field spans (non-overlapping, first wins).
  const segments = useMemo(() => {
    const spans = fields.filter((f) => f.sourceStart !== null && f.sourceEnd !== null && f.sourceEnd > f.sourceStart).sort((a, b) => a.sourceStart! - b.sourceStart!);
    const out: { text: string; fieldId?: string }[] = [];
    let cursor = 0;
    for (const f of spans) {
      if (f.sourceStart! < cursor) continue;
      out.push({ text: doc.text.slice(cursor, f.sourceStart!) });
      out.push({ text: doc.text.slice(f.sourceStart!, f.sourceEnd!), fieldId: f.id });
      cursor = f.sourceEnd!;
    }
    out.push({ text: doc.text.slice(cursor) });
    return out;
  }, [fields, doc.text]);

  function focusField(id: string) {
    setActive(id);
    const el = textRef.current?.querySelector(`[data-field="${id}"]`);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function action(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const hasText = doc.text.trim().length > 0;
  const isImage = doc.mimeType.startsWith("image/");
  const isPdf = doc.mimeType === "application/pdf";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <Link href={commandHref(`Create a project from the ${doc.title} document`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg">
          <FolderPlus className="size-3.5" /> Create project from this
        </Link>
        <Link href={commandHref(`Create a task for the deadline in ${doc.title}`)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elev px-3 text-xs font-medium text-fg hover:bg-hover">
          <ListPlus className="size-3.5" /> Task for a deadline
        </Link>
        <Button size="sm" disabled={!!busy} onClick={() => action("reprocess", async () => { const r = await apiFetch<{ summary: string }>(`/api/documents/${doc.id}`, { body: { action: "reprocess" } }); toast.success(r.summary); router.refresh(); })}>
          {busy === "reprocess" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Re-extract
        </Button>
        <a href={`/api/documents/${doc.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-elev px-3 text-xs font-medium text-fg hover:bg-hover">
          <Download className="size-3.5" /> Download original
        </a>
        <Button
          size="sm"
          variant="ghost"
          disabled={!!busy}
          onClick={() => {
            if (!window.confirm(`Permanently delete “${doc.title}” and its extracted fields?`)) return;
            action("delete", async () => {
              await apiFetch(`/api/documents/${doc.id}`, { method: "DELETE" });
              toast.success("Document deleted");
              router.push("/documents");
            });
          }}
        >
          <Trash2 /> Delete
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[400px_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Extracted fields (${fields.length})`} subtitle="Click a field to see its source in the document" />
            <ul className="divide-y divide-line border-t border-line">
              {fields.map((f) => (
                <FieldRow key={f.id} f={f} docId={doc.id} active={active === f.id} onFocus={() => focusField(f.id)} />
              ))}
              {!fields.length && <li className="px-5 py-4 text-sm text-muted">No structured fields recognised. Try setting the document type and re-extracting.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Linked to" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {links.map((l, i) => (
                <li key={i}>
                  <div className="flex items-center gap-2">
                    <span className="w-20 shrink-0 text-xs text-faint">{l.relation.replace("_", " ")}</span>
                    <EntityLink entity={l.ref} />
                  </div>
                  {l.rationale && <div className="pl-22 text-[11px] text-faint">{l.rationale}</div>}
                </li>
              ))}
              {!links.length && <li className="text-faint">No people, companies or opportunities recognised.</li>}
            </ul>
          </Card>
        </div>

        <Card className="min-w-0">
          <CardHeader title="Document" subtitle={doc.filename} />
          {isImage && <img src={`/api/documents/${doc.id}?inline=1`} alt={doc.title} className="mx-5 mb-4 max-h-[60vh] rounded-lg border border-line object-contain" />}
          {isPdf && !hasText && <iframe src={`/api/documents/${doc.id}?inline=1`} title={doc.title} className="mx-5 mb-4 h-[70vh] w-[calc(100%-2.5rem)] rounded-lg border border-line" />}
          {hasText ? (
            <div ref={textRef} className="mx-5 mb-5 max-h-[75vh] overflow-auto rounded-lg border border-line bg-sunken p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-fg/90">
              {segments.map((seg, i) =>
                seg.fieldId ? (
                  <mark
                    key={i}
                    data-field={seg.fieldId}
                    onClick={() => setActive(seg.fieldId!)}
                    className={cn("lifeos-hl cursor-pointer transition-shadow", active === seg.fieldId && "shadow-[0_0_0_2px_var(--accent)]")}
                    title={fields.find((f) => f.id === seg.fieldId)?.label}
                  >
                    {seg.text}
                  </mark>
                ) : (
                  <Fragment key={i}>{seg.text}</Fragment>
                ),
              )}
            </div>
          ) : (
            !isImage && !isPdf && <p className="px-5 pb-5 text-sm text-muted">No text could be extracted from this file.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function FieldRow({ f, docId, active, onFocus }: { f: Field; docId: string; active: boolean; onFocus: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(f.value);
  const router = useRouter();
  async function save(body: Record<string, unknown>) {
    try {
      await apiFetch(`/api/documents/${docId}/fields/${f.id}`, { method: "PATCH", body });
      toast.success(body.value !== undefined ? "Corrected — your value is kept on re-extraction" : "Verified");
      setEditing(false);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const derived = f.key === "notice_deadline" || f.key === "risks";
  return (
    <li className={cn("px-5 py-3 transition-colors", active && "bg-accent-soft")}>
      <button type="button" onClick={onFocus} className="block w-full text-left" disabled={f.sourceStart === null}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] tracking-wide text-muted uppercase">{f.label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            <ProvenanceTag p={f.method === "user" ? "user_input" : derived ? "ai_inference" : "fact"} />
            <span className={cn("font-mono text-[10px]", f.confidence >= 0.8 ? "text-success" : f.confidence >= 0.6 ? "text-signal" : "text-danger")}>{Math.round(f.confidence * 100)}%</span>
          </span>
        </div>
        {!editing && <div className="mt-1 text-sm whitespace-pre-line text-fg">{f.value}</div>}
      </button>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(6, value.split("\n").length + 1)} />
          <div className="flex gap-1">
            <Button size="sm" variant="primary" onClick={() => save({ value })}>
              <Check /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              <X /> Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge>{f.method}</Badge>
          {f.verified ? <Badge tone="success">verified</Badge> : (
            <button onClick={() => save({ verified: true })} className="text-[11px] text-accent hover:underline">
              verify
            </button>
          )}
          <button onClick={() => setEditing(true)} className="inline-flex items-center gap-0.5 text-[11px] text-muted hover:text-fg">
            <Pencil className="size-3" /> correct
          </button>
          {f.sourceStart === null && f.sourceText === null && <span className="text-[11px] text-faint">no source span</span>}
        </div>
      )}
    </li>
  );
}
