import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowUpRight, CalendarClock, FileText, GraduationCap, MessageSquare, Users } from "lucide-react";
import { getWorld } from "@/server/services/context";
import { annualValue, opportunityFit } from "@/server/engine/signals";
import { assumedSuccess, nextActionFor } from "@/server/engine/radar";
import { linksOf } from "@/server/engine/world";
import { longDate, money, relativeDay, shortDate } from "@/lib/format";
import { Badge, Card, CardHeader, Progress } from "@/components/ui/primitives";
import { EntityLink } from "@/components/lifeos/entity";
import { ProvenanceTag } from "@/components/lifeos/provenance";
import { EntitySelect } from "@/components/lifeos/controls";
import { QuickAsk } from "@/components/lifeos/quick-ask";
import { commandHref } from "@/components/lifeos/insight-card";

export const metadata: Metadata = { title: "Opportunity" };

export default async function OpportunityPage(props: PageProps<"/opportunities/[id]">) {
  const { id } = await props.params;
  const w = await getWorld();
  const o = w.idx.opportunity.get(id);
  if (!o) notFound();
  const fit = opportunityFit(w, o.id);
  const company = o.companyId ? w.idx.company.get(o.companyId) : undefined;
  const contact = o.contactPersonId ? w.idx.person.get(o.contactPersonId) : undefined;
  const app = w.applications.find((a) => a.opportunityId === o.id);
  const links = linksOf(w, "opportunity", o.id);
  const docs = links.filter((l) => l.fromType === "document").map((l) => w.idx.document.get(l.fromId)).filter(Boolean);
  const projects = links.filter((l) => l.fromType === "project" || l.toType === "project").map((l) => w.idx.project.get(l.fromType === "project" ? l.fromId : l.toId)).filter(Boolean);
  const goals = links.filter((l) => l.toType === "goal").map((l) => w.idx.goal.get(l.toId)).filter(Boolean);
  const messages = w.messages.filter((m) => m.opportunityId === o.id || (contact && m.personId === contact.id)).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  const events = w.events.filter((e) => e.opportunityId === o.id).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const p = assumedSuccess(fit.score, o.type, o.status);
  const annual = annualValue(o);
  const docFields = w.documentFields.filter((f) => docs.some((d) => d!.id === f.documentId));

  return (
    <div className="mx-auto max-w-6xl">
      <Link href="/opportunities" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Opportunities
      </Link>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent">{o.type.replace("_", " ")}</Badge>
            <Badge>source: {o.source.replace("_", " ")}</Badge>
            {fit.visaRisk.blocked && <Badge tone="danger">no visa sponsorship</Badge>}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{o.title}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            {company && <EntityLink entity={{ type: "company", id: company.id, label: company.name }} />}
            {o.location && <span>{o.location}</span>}
            {o.deadline && <span className="text-signal">Deadline {longDate(o.deadline)} ({relativeDay(o.deadline, w.now)})</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">Status</span>
          <EntitySelect type="opportunity" id={o.id} field="status" value={o.status} options={["identified", "researching", "preparing", "applied", "interviewing", "offer", "won", "lost", "dismissed"]} />
        </div>
      </div>

      <div className="mb-6 rounded-xl border border-accent/40 bg-accent-soft px-4 py-3">
        <div className="text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">Next action</div>
        <p className="mt-1 text-sm text-fg">{nextActionFor(w, o.id)}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Fit · ${Math.round(fit.score * 100)}%`} icon={<GraduationCap />} subtitle="Skill coverage weighted by level, plus evidence, warm contacts and visa constraints." />
            <div className="space-y-4 px-5 pb-5">
              <Progress value={fit.score} tone={fit.score >= 0.75 ? "success" : fit.score >= 0.5 ? "accent" : "signal"} />
              <div className="grid gap-2 sm:grid-cols-2">
                {fit.components.map((c) => (
                  <div key={c.factor} className="flex items-center justify-between rounded-lg border border-line bg-sunken px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-fg">{c.factor}</div>
                      <div className="truncate text-[11px] text-faint">{c.note}</div>
                    </div>
                    <span className={`font-mono text-sm ${c.value < 0 ? "text-danger" : "text-accent"}`}>{c.value > 0 ? "+" : ""}{c.value}</span>
                  </div>
                ))}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] tracking-wide text-faint uppercase">
                    <th className="pb-2 font-medium">Skill</th>
                    <th className="pb-2 font-medium">You</th>
                    <th className="pb-2 font-medium">Needed</th>
                    <th className="pb-2 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {[...fit.matched.map((m) => ({ ...m, ok: true, essential: true })), ...fit.gaps.map((g) => ({ ...g, ok: false, evidencedBy: [] as string[] }))].map((r) => (
                    <tr key={r.name}>
                      <td className="py-2 text-fg">
                        {r.name} {!r.essential && <span className="text-[10px] text-faint">(nice to have)</span>}
                      </td>
                      <td className="py-2 font-mono text-xs">{r.have}/5</td>
                      <td className={`py-2 font-mono text-xs ${r.ok ? "text-success" : "text-danger"}`}>{r.need}/5</td>
                      <td className="py-2 text-xs text-muted">{r.evidencedBy.length ? r.evidencedBy.join(", ") : r.ok ? <span className="text-signal">no project evidence</span> : "—"}</td>
                    </tr>
                  ))}
                  {!fit.matched.length && !fit.gaps.length && (
                    <tr>
                      <td colSpan={4} className="py-3 text-xs text-faint">No skill requirements recorded for this opportunity.</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {fit.visaRisk.text && (
                <div className="flex gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-sm">
                  <ProvenanceTag p="fact" className="mt-0.5" />
                  <span className={fit.visaRisk.blocked ? "text-danger" : "text-fg/90"}>Visa: “{fit.visaRisk.text}”</span>
                </div>
              )}
            </div>
          </Card>

          {o.description && (
            <Card>
              <CardHeader title="Description" />
              <p className="px-5 pb-5 text-sm whitespace-pre-wrap text-fg/90">{o.description}</p>
            </Card>
          )}

          {docFields.length > 0 && (
            <Card>
              <CardHeader title="From the job description" icon={<FileText />} subtitle="Extracted fields with their source documents" />
              <dl className="grid gap-x-6 gap-y-3 px-5 pb-5 sm:grid-cols-2">
                {docFields.filter((f) => ["salary", "location", "deadline", "experience", "requirements", "responsibilities"].includes(f.key)).map((f) => (
                  <div key={f.id} className="min-w-0">
                    <dt className="text-[11px] tracking-wide text-faint uppercase">{f.label}</dt>
                    <dd className="mt-0.5 text-sm whitespace-pre-line text-fg/90">{f.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          <Card>
            <CardHeader title="Ask about this opportunity" />
            <div className="px-5 pb-5">
              <QuickAsk placeholder={`Ask about ${o.title.split("—")[0].trim()}…`} suggestions={[`Analyze this opportunity ${o.title}`, `Should I apply to ${o.title}?`, ...(contact ? [`Draft a reply to ${contact.name}`] : [])]} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Value & odds" />
            <dl className="space-y-3 px-5 pb-5 text-sm">
              <Row label="Stated value" value={o.valueLow !== null ? `${money(o.valueLow)}${o.valueHigh !== o.valueLow ? `–${money(o.valueHigh)}` : ""} ${o.valuePeriod?.replace("_", " ") ?? ""}` : "—"} p={o.source === "ai_inference" ? "estimate" : "fact"} />
              <Row label="Annualised midpoint" value={annual !== null ? money(annual) : "—"} p="estimate" />
              <Row label="Assumed success rate" value={`${Math.round(p * 100)}%`} p="assumption" />
              <Row label="Risk-adjusted value" value={annual !== null ? money(annual * p) : "—"} p="estimate" />
              <Row label="Effort" value={o.effortHours !== null ? `${o.effortHours} h` : "—"} p="estimate" />
              <Row label="Difficulty" value={o.difficulty ? `${o.difficulty}/5` : "—"} p="user_input" />
              <p className="text-[11px] text-faint">Success rate = base rate for {o.type} × stage × fit. It's an explicit assumption for comparing routes, not a prediction.</p>
            </dl>
          </Card>

          <Card>
            <CardHeader title="Connections" icon={<Users />} />
            <ul className="space-y-2 px-5 pb-5 text-sm">
              {contact && <li><EntityLink entity={{ type: "person", id: contact.id, label: `${contact.name} — ${contact.role ?? ""}` }} /></li>}
              {fit.contacts.filter((c) => c.personId !== contact?.id).map((c) => <li key={c.personId}><EntityLink entity={{ type: "person", id: c.personId, label: `${c.name} (${c.relation.replace("_", " ")})` }} /></li>)}
              {projects.map((pr) => <li key={pr!.id}><EntityLink entity={{ type: "project", id: pr!.id, label: pr!.title }} /></li>)}
              {goals.map((g) => <li key={g!.id}><EntityLink entity={{ type: "goal", id: g!.id, label: g!.title }} /></li>)}
              {docs.map((d) => <li key={d!.id}><EntityLink entity={{ type: "document", id: d!.id, label: d!.title }} /></li>)}
              {!contact && !projects.length && !goals.length && !docs.length && !fit.contacts.length && <li className="text-faint">No connections yet.</li>}
            </ul>
          </Card>

          {(events.length > 0 || app) && (
            <Card>
              <CardHeader title="Timeline" icon={<CalendarClock />} />
              <ul className="space-y-2 px-5 pb-5 text-sm">
                {app?.submittedAt && <li className="flex justify-between gap-2"><span className="text-muted">Applied</span><span className="font-mono text-xs">{shortDate(app.submittedAt)}</span></li>}
                {app?.lastFollowUpAt && <li className="flex justify-between gap-2"><span className="text-muted">Last follow-up</span><span className="font-mono text-xs">{shortDate(app.lastFollowUpAt)}</span></li>}
                {events.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span className="text-fg">{e.title}</span>
                    <span className="shrink-0 font-mono text-xs text-accent">{relativeDay(e.startsAt, w.now)}</span>
                  </li>
                ))}
                {app?.nextStep && <li className="text-xs text-faint">Next step: {app.nextStep}</li>}
              </ul>
            </Card>
          )}

          {messages.length > 0 && (
            <Card>
              <CardHeader title="Messages" icon={<MessageSquare />} />
              <ul className="space-y-3 px-5 pb-5">
                {messages.slice(0, 4).map((m) => (
                  <li key={m.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
                      <span>{m.direction === "in" ? "Received" : "Sent"} · {m.channel}</span>
                      <span>{shortDate(m.occurredAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-fg/90">{m.body}</p>
                    {m.needsReply && (
                      <Link href={commandHref(`Draft a reply to ${w.idx.person.get(m.personId ?? "")?.name ?? ""}`)} className="mt-1 inline-flex items-center gap-1 text-xs text-signal">
                        Needs reply — draft one <ArrowUpRight className="size-3" />
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, p }: { label: string; value: string; p: "fact" | "estimate" | "assumption" | "user_input" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="flex items-center gap-1.5 text-right font-mono text-xs text-fg">
        {value} <ProvenanceTag p={p} />
      </dd>
    </div>
  );
}
