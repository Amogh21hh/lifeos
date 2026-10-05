import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageSquare, PhoneCall } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { relationshipHeat } from "@/server/engine/signals";
import { neighbours } from "@/server/search/search";
import { refOf } from "@/server/engine/world";
import { relativeDay, shortDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { Badge, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { EntityAction, EntitySelect } from "@/components/lifeos/controls";
import { EntityLink } from "@/components/lifeos/entity";
import { QuickAsk } from "@/components/lifeos/quick-ask";
import type { EntityType } from "@/lib/types";

export const metadata: Metadata = { title: "Person" };

export default async function PersonPage(props: PageProps<"/people/[id]">) {
  const { id } = await props.params;
  const w = await getWorld();
  const p = w.idx.person.get(id);
  if (!p) notFound();
  const heat = relationshipHeat(p, w.now);
  const company = p.companyId ? w.idx.company.get(p.companyId) : undefined;
  const messages = w.messages.filter((m) => m.personId === p.id).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const commitments = w.commitments.filter((c) => c.toPersonId === p.id);
  const graph = [...neighbours(w, "person", p.id).entries()].filter(([k]) => !k.startsWith("message:") && !k.startsWith("commitment:")).slice(0, 14);
  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/people" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> People
      </Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{p.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {p.role}
            {company ? ` · ${company.name}` : ""} · {p.relationship}
            {p.email ? ` · ${p.email}` : ""}
          </p>
          {p.notes && <p className="mt-2 max-w-2xl text-sm text-fg/90">{p.notes}</p>}
        </div>
        <div className="flex items-center gap-2">
          <EntityAction type="person" id={p.id} body={{ action: "contacted" }} label="Log contact" icon={<PhoneCall />} success="Contact logged" />
          <EntitySelect type="person" id={p.id} field="strength" value={String(p.strength)} options={["1", "2", "3", "4", "5"]} />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card className="p-5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">Relationship warmth</span>
              <span className={cn("font-mono", heat.cooling ? "text-signal" : "text-success")}>{heat.cooling ? "cooling" : "warm"}</span>
            </div>
            <Progress value={heat.heat} className="mt-2" tone={heat.cooling ? "signal" : "success"} />
            <p className="mt-2 text-xs text-faint">
              {heat.daysSince >= 999 ? "No contact recorded." : `${heat.daysSince} days since contact.`} For a tie of strength {p.strength}/5, silence beyond ~{heat.tolerance} days usually means the relationship is cooling. ESTIMATE
            </p>
          </Card>
          <Card>
            <CardHeader title="Conversation history" icon={<MessageSquare />} />
            <ul className="space-y-4 px-5 pb-5">
              {messages.map((m) => (
                <li key={m.id} className={cn("max-w-[90%] rounded-xl border px-3.5 py-2.5 text-sm", m.direction === "out" ? "ml-auto border-accent/30 bg-accent-soft" : "border-line bg-sunken")}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-faint">
                    <span>
                      {m.direction === "in" ? p.name.split(" ")[0] : "You"} · {m.channel}
                    </span>
                    <span>{shortDate(m.occurredAt)}</span>
                  </div>
                  {m.subject && <div className="font-medium text-fg">{m.subject}</div>}
                  <p className="whitespace-pre-wrap text-fg/90">{m.body}</p>
                  {m.needsReply && m.direction === "in" && <Badge tone="danger" className="mt-1.5">needs reply</Badge>}
                </li>
              ))}
              {!messages.length && <li className="text-sm text-faint">No messages recorded.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title={`Ask about ${p.name.split(" ")[0]}`} />
            <div className="px-5 pb-5">
              <QuickAsk placeholder={`e.g. Draft a check-in to ${p.name}`} suggestions={[`Draft a reply to ${p.name}`, `Find everything connected to ${p.name}`]} />
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Promises" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {commitments.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className={cn("text-fg", c.status === "done" && "line-through opacity-60")}>{c.title}</div>
                    {c.dueDate && <div className={cn("text-xs", c.status === "open" && c.dueDate < w.now.toISOString().slice(0, 10) ? "text-danger" : "text-faint")}>due {relativeDay(c.dueDate, w.now)}</div>}
                  </div>
                  {c.status === "open" && <EntityAction type="commitment" id={c.id} body={{ status: "done" }} label="Kept" size="icon-sm" variant="ghost" success="Promise kept" />}
                </li>
              ))}
              {!commitments.length && <li className="text-faint">No promises recorded.</li>}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Connected to" />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {graph.map(([key, v]) => {
                const [t, i] = key.split(":");
                return (
                  <li key={key} className="flex items-center gap-2">
                    <span className="w-24 shrink-0 truncate text-xs text-faint">{v.via}</span>
                    <EntityLink entity={refOf(w, t as EntityType, i)} />
                  </li>
                );
              })}
              {!graph.length && <li className="text-faint">No connections.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
