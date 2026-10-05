import type { Metadata } from "next";
import Link from "next/link";
import { FileText } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { relativeDay } from "@/lib/format";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Uploader } from "./uploader";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const w = await getWorld();
  const docs = [...w.documents].sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader eyebrow="Document intelligence" title="Documents" description="Upload job descriptions, invoices, contracts, CVs, statements and letters. LIFEOS classifies them, extracts structured fields with the exact source text, links them to people, companies and opportunities, and watches for deadlines." />
      <Card className="mb-8">
        <CardHeader title="Upload" subtitle="PDF, DOCX, XLSX, CSV, TXT, MD or images · max 10 MB · validated by content, never executed" />
        <div className="px-5 pb-5">
          <Uploader />
        </div>
      </Card>
      {docs.length === 0 ? (
        <EmptyState icon={<FileText />} title="No documents yet" body="Upload a job description to see extraction in action." />
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-elev">
          <ul className="divide-y divide-line">
            {docs.map((d) => {
              const fields = w.documentFields.filter((f) => f.documentId === d.id);
              const upcoming = fields.filter((f) => f.valueType === "date" && f.value >= w.now.toISOString().slice(0, 10)).sort((a, b) => a.value.localeCompare(b.value))[0];
              return (
                <li key={d.id}>
                  <Link href={`/documents/${d.id}`} className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-hover/50 sm:flex-row sm:items-center">
                    <FileText className="hidden size-5 shrink-0 text-p-assumption sm:block" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-fg">{d.title}</div>
                      <div className="truncate text-xs text-muted">{d.summary ?? d.filename}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone="accent">{d.kind.replace("_", " ")}</Badge>
                      <Badge>{fields.length} fields</Badge>
                      {d.status !== "processed" && <Badge tone={d.status === "failed" ? "danger" : "signal"}>{d.status}</Badge>}
                      {upcoming && <Badge tone="signal">{upcoming.label.toLowerCase()} {relativeDay(upcoming.value, w.now)}</Badge>}
                      <span className="font-mono text-[11px] text-faint">{relativeDay(d.uploadedAt, w.now)}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
