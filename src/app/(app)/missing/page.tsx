import type { Metadata } from "next";
import { ScanSearch } from "lucide-react";
import { whatAmIMissing, DETECTORS } from "@/server/engine/missing";
import { getInsightStatuses, getWorld } from "@/server/services/context";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { InsightCard } from "@/components/lifeos/insight-card";
import { RefreshButton } from "@/components/lifeos/refresh-button";

export const metadata: Metadata = { title: "What am I missing?" };

const GROUPS: { title: string; detectors: string[] }[] = [
  { title: "Time-sensitive", detectors: ["untrackedDocumentDeadlines", "deadlinesWithoutPrep", "overdueCommitments", "unansweredMessages", "quickWins"] },
  { title: "Opportunities you're under-using", detectors: ["unlinkedEvidence", "applicationFollowUps", "coolingRelationships", "skillGapClusters", "visaRunway"] },
  { title: "Stuck work", detectors: ["cheapUnblocks", "repeatedPostponement", "goalsWithoutNextAction", "neglectedGoals"] },
  { title: "Patterns", detectors: ["timeMisallocation", "subscriptionsMisaligned", "decisionReviewsDue"] },
];

export default async function MissingPage() {
  const w = await getWorld();
  const statuses = await getInsightStatuses();
  const all = whatAmIMissing(w);
  const shown = all.filter((i) => !statuses.has(i.key));
  const hiddenCount = all.length - shown.length;
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        eyebrow="Blind-spot analysis"
        title="What am I missing?"
        description={`${Object.keys(DETECTORS).length} independent detectors scan your goals, projects, deadlines, opportunities, documents, skills, activity and commitments. A detector only speaks when it can cite records — open any item to see its evidence.`}
        actions={<RefreshButton label="Re-run analysis" />}
      />
      <div className="mb-6 flex flex-wrap items-center gap-2 text-sm text-muted">
        <Badge tone="danger">{shown.filter((i) => i.severity === "critical").length} critical</Badge>
        <Badge tone="signal">{shown.filter((i) => i.severity === "important").length} important</Badge>
        <Badge tone="accent">{shown.filter((i) => i.severity === "watch").length} watch</Badge>
        <Badge>{shown.filter((i) => i.severity === "info").length} info</Badge>
        {hiddenCount > 0 && <span className="text-xs text-faint">· {hiddenCount} dismissed or done</span>}
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<ScanSearch />} title="No blind spots detected" body="Every detector ran and found nothing it could back with evidence." />
      ) : (
        <div className="space-y-8">
          {GROUPS.map((g) => {
            const items = shown.filter((i) => g.detectors.includes(i.detector ?? ""));
            if (!items.length) return null;
            return (
              <section key={g.title}>
                <h2 className="mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted uppercase">
                  {g.title} <span className="font-mono text-faint">({items.length})</span>
                </h2>
                <div className="space-y-2">
                  {items.map((i) => (
                    <InsightCard key={i.key} item={i} dismissible />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
