import { PROVENANCE_LABEL, type Confidence, type Provenance } from "@/lib/types";
import { cn } from "@/lib/cn";

const P_STYLE: Record<Provenance, string> = {
  fact: "text-p-fact border-p-fact/30 bg-p-fact/10",
  estimate: "text-p-estimate border-p-estimate/30 bg-p-estimate/10",
  assumption: "text-p-assumption border-p-assumption/30 bg-p-assumption/10",
  user_input: "text-p-user border-p-user/30 bg-p-user/10",
  ai_inference: "text-p-ai border-p-ai/30 bg-p-ai/10",
};

const P_HELP: Record<Provenance, string> = {
  fact: "Directly recorded in your data or a document",
  estimate: "Calculated from your data — an approximation",
  assumption: "A stated assumption the analysis depends on",
  user_input: "Something you told LIFEOS",
  ai_inference: "Inferred by LIFEOS from patterns — verify it",
};

export function ProvenanceTag({ p, className }: { p: Provenance; className?: string }) {
  return (
    <span title={P_HELP[p]} className={cn("inline-flex shrink-0 items-center rounded border px-1 py-px font-mono text-[9px] font-semibold tracking-wider whitespace-nowrap", P_STYLE[p], className)}>
      {PROVENANCE_LABEL[p]}
    </span>
  );
}

export function ConfidenceMeter({ level, score, className }: { level: Confidence; score?: number; className?: string }) {
  const bars = level === "high" ? 3 : level === "medium" ? 2 : 1;
  const color = level === "high" ? "bg-success" : level === "medium" ? "bg-signal" : "bg-danger";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[11px] text-muted", className)} title={score !== undefined ? `Confidence ${Math.round(score * 100)}%` : undefined}>
      <span className="inline-flex items-end gap-px" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span key={i} className={cn("w-1 rounded-sm", i < bars ? color : "bg-line-strong")} style={{ height: 5 + i * 3 }} />
        ))}
      </span>
      <span className="capitalize">{level}</span>
      {score !== undefined && <span className="font-mono text-faint">{Math.round(score * 100)}%</span>}
    </span>
  );
}

export function ProvenanceLegend() {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {(Object.keys(PROVENANCE_LABEL) as Provenance[]).map((p) => (
        <ProvenanceTag key={p} p={p} />
      ))}
    </div>
  );
}
