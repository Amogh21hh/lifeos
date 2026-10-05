import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import * as s from "@/server/db/schema";
import { getViewer, getWorld } from "@/server/services/context";
import { linksOf, refOf } from "@/server/engine/world";
import { longDate } from "@/lib/format";
import { Badge } from "@/components/ui/primitives";
import type { EntityType } from "@/lib/types";
import { DocumentView } from "./document-view";

export const metadata: Metadata = { title: "Document" };

export default async function DocumentPage(props: PageProps<"/documents/[id]">) {
  const { id } = await props.params;
  const { db, user } = await getViewer();
  const [doc] = await db.select().from(s.documents).where(and(eq(s.documents.id, id), eq(s.documents.userId, user.id)));
  if (!doc) notFound();
  const w = await getWorld();
  const fields = w.documentFields.filter((f) => f.documentId === id);
  const links = linksOf(w, "document", id).map((l) => ({ relation: l.relation, rationale: l.rationale, ref: l.fromId === id ? refOf(w, l.toType as EntityType, l.toId) : refOf(w, l.fromType as EntityType, l.fromId) }));
  return (
    <div className="mx-auto max-w-7xl">
      <Link href="/documents" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Documents
      </Link>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{doc.kind.replace("_", " ")}</Badge>
          <Badge>{doc.extractionMethod ?? "rules"}</Badge>
          <Badge>{(doc.sizeBytes / 1024).toFixed(1)} KB</Badge>
          {doc.pageCount && <Badge>{doc.pageCount} page{doc.pageCount > 1 ? "s" : ""}</Badge>}
          <span className="text-xs text-faint">Uploaded {longDate(doc.uploadedAt)}</span>
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{doc.title}</h1>
        {doc.summary && <p className="mt-1 max-w-3xl text-sm text-muted">{doc.summary}</p>}
        {doc.error && <p className="mt-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">Processing failed: {doc.error}</p>}
      </div>
      <DocumentView
        doc={{ id: doc.id, title: doc.title, filename: doc.filename, mimeType: doc.mimeType, kind: doc.kind, text: doc.textContent ?? "" }}
        fields={fields.map((f) => ({ id: f.id, key: f.key, label: f.label, value: f.value, valueType: f.valueType, confidence: f.confidence, sourceText: f.sourceText, sourceStart: f.sourceStart, sourceEnd: f.sourceEnd, method: f.method, verified: f.verified }))}
        links={links}
      />
    </div>
  );
}
