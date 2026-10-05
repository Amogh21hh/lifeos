import type { Metadata } from "next";
import Link from "next/link";
import { Users } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { relationshipHeat } from "@/server/engine/signals";
import { relativeDay } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, EmptyState, PageHeader } from "@/components/ui/primitives";
import { CreateEntityDialog } from "@/components/lifeos/controls";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage(props: PageProps<"/people">) {
  const sp = await props.searchParams;
  const w = await getWorld();
  const companyFilter = typeof sp.company === "string" ? sp.company : null;
  const company = companyFilter ? w.idx.company.get(companyFilter) : undefined;
  const people = w.people
    .filter((p) => !companyFilter || p.companyId === companyFilter)
    .map((p) => ({ p, heat: relationshipHeat(p, w.now), waiting: w.messages.some((m) => m.personId === p.id && m.direction === "in" && m.needsReply), promises: w.commitments.filter((c) => c.toPersonId === p.id && c.status === "open").length }))
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || b.p.strength - a.p.strength);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        eyebrow="Personal CRM"
        title={company ? `People at ${company.name}` : "People"}
        description="Relationships, with warmth computed from tie strength and time since contact. LIFEOS flags strong ties going cold and messages waiting for you."
        actions={
          <CreateEntityDialog
            type="person"
            title="New person"
            fields={[
              { name: "name", label: "Name", required: true },
              { name: "role", label: "Role" },
              { name: "email", label: "Email", type: "email" },
              { name: "relationship", label: "Relationship", type: "select", required: true, options: ["recruiter", "mentor", "peer", "manager", "client", "friend", "family", "other"].map((v) => ({ value: v, label: v })) },
              { name: "strength", label: "Tie strength (1–5)", type: "number", defaultValue: "2" },
              { name: "notes", label: "Notes", type: "textarea" },
            ]}
          />
        }
      />
      {company && (
        <Link href="/people" className="mb-4 inline-block text-sm text-accent">
          ← All people
        </Link>
      )}
      {people.length === 0 ? (
        <EmptyState icon={<Users />} title="No people yet" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {people.map(({ p, heat, waiting, promises }) => (
            <Link key={p.id} href={`/people/${p.id}`} className="rounded-xl border border-line bg-elev p-4 transition-colors hover:border-line-strong">
              <div className="flex items-center gap-3">
                <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-sunken font-mono text-sm font-semibold text-fg">
                  {p.name.split(" ").map((x) => x[0]).join("").slice(0, 2)}
                  <span className={cn("absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-elev", heat.cooling ? "bg-signal" : heat.heat > 0.6 ? "bg-success" : "bg-accent")} />
                </span>
                <div className="min-w-0">
                  <div className="truncate font-medium text-fg">{p.name}</div>
                  <div className="truncate text-xs text-muted">
                    {p.role}
                    {p.companyId ? ` · ${w.idx.company.get(p.companyId)?.name}` : ""}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge>{p.relationship}</Badge>
                <Badge>tie {p.strength}/5</Badge>
                <Badge tone={heat.cooling ? "warning" : "neutral"}>{p.lastContactAt ? `contact ${relativeDay(p.lastContactAt, w.now)}` : "never contacted"}</Badge>
                {waiting && <Badge tone="danger">waiting on you</Badge>}
                {promises > 0 && <Badge tone="signal">{promises} promise{promises > 1 ? "s" : ""}</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
