"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Check, Cpu, Database, Download, Link2, Loader2, Plug, RefreshCw, RotateCcw, Unplug, Wrench } from "lucide-react";
import { toast } from "sonner";
import type { AIStatus } from "@/server/ai/llm";
import { apiFetch } from "@/lib/client-api";
import { cn } from "@/lib/cn";
import { Badge, Button, Card, CardHeader, Input, Label } from "@/components/ui/primitives";

interface Integration {
  kind: string;
  label: string;
  adapter: string;
  description: string;
  production: string;
  status: string;
  lastSyncAt: string | null;
  lastSyncSummary: string | null;
}

export function SettingsForms({ isDemo, profile, settings, system, integrations, tools, agents }: {
  isDemo: boolean;
  profile: { name: string; headline: string; email: string };
  settings: { aiMode: string; focusHoursPerWeek: number; followUpDays: number; neglectDays: number; hourlyValueEstimate: number };
  system: { ai: AIStatus; embeddings: string; db: string };
  integrations: Integration[];
  tools: { name: string; description: string; permission: string; autoApprove: boolean; risk: string }[];
  agents: { name: string; description: string; tools: string[]; responsibilities: string[] }[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ ...profile, ...settings });

  async function save(body: Record<string, unknown>) {
    setBusy("save");
    try {
      await apiFetch("/api/settings", { method: "PATCH", body });
      toast.success("Saved");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  async function integration(kind: string, action: string) {
    setBusy(`${kind}:${action}`);
    try {
      const r = await apiFetch<{ summary?: string }>(`/api/integrations/${kind}`, { body: { action } });
      toast.success(r.summary ?? `${kind} ${action}ed`);
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Profile & reasoning" icon={<Cpu />} />
        <form
          className="grid gap-4 px-5 pb-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save({ name: form.name, headline: form.headline, focusHoursPerWeek: Number(form.focusHoursPerWeek), followUpDays: Number(form.followUpDays), neglectDays: Number(form.neglectDays), hourlyValueEstimate: Number(form.hourlyValueEstimate) });
          }}
        >
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={80} /></Field>
          <Field label="Headline"><Input value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} maxLength={200} /></Field>
          <Field label="Focus hours per week" hint="Capacity used by focus plans and simulations"><Input type="number" min={1} max={100} value={form.focusHoursPerWeek} onChange={(e) => setForm({ ...form, focusHoursPerWeek: Number(e.target.value) })} /></Field>
          <Field label="Follow up after (days)" hint="When silent applications become a blind spot"><Input type="number" min={1} max={60} value={form.followUpDays} onChange={(e) => setForm({ ...form, followUpDays: Number(e.target.value) })} /></Field>
          <Field label="Goal neglect threshold (days)" hint="Quiet goals beyond this are flagged"><Input type="number" min={2} max={120} value={form.neglectDays} onChange={(e) => setForm({ ...form, neglectDays: Number(e.target.value) })} /></Field>
          <Field label="Hourly value estimate (£)" hint="Used when weighing time against money"><Input type="number" min={0} value={form.hourlyValueEstimate} onChange={(e) => setForm({ ...form, hourlyValueEstimate: Number(e.target.value) })} /></Field>
          <div className="sm:col-span-2">
            <Button type="submit" variant="primary" disabled={busy === "save"}>{busy === "save" ? <Loader2 className="animate-spin" /> : <Check />} Save</Button>
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title="AI engine" icon={<Bot />} />
        <div className="space-y-4 px-5 pb-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <Info label="Language model" value={system.ai.available ? `${system.ai.engine} · ${system.ai.model}` : "Local reasoning engine"} ok={system.ai.available} />
            <Info label="Embeddings" value={system.embeddings} ok />
            <Info label="Database" value={system.db === "pglite" ? "Embedded Postgres (PGlite + pgvector)" : "PostgreSQL + pgvector"} ok />
          </div>
          <p className="text-sm text-muted">{system.ai.reason} All analysis (ranking, blind spots, decisions, simulations, search) runs on deterministic engines over your data. A configured model adds intent parsing, document extraction, decision drafting and grounded narration — it never gets to act without the tool permission system.</p>
          <div className="flex flex-wrap gap-2">
            {[
              { v: "auto", label: "Use AI model when configured" },
              { v: "local", label: "Local only — never send data to a model provider" },
            ].map((o) => (
              <button
                key={o.v}
                onClick={() => {
                  setForm({ ...form, aiMode: o.v });
                  save({ aiMode: o.v });
                }}
                className={cn("rounded-lg border px-3 py-2 text-sm", form.aiMode === o.v ? "border-accent/60 bg-accent-soft text-fg" : "border-line text-muted hover:text-fg")}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Integrations" icon={<Link2 />} subtitle="Provider adapters behind stable interfaces. This build ships mock adapters that exercise the full sync → normalise → dedupe → index pipeline." />
        <ul className="divide-y divide-line border-t border-line">
          {integrations.map((i) => (
            <li key={i.kind} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-fg">{i.label}</span>
                  <Badge tone={i.status === "connected" ? "success" : "neutral"}>{i.status}</Badge>
                  <Badge className="font-mono">{i.adapter}</Badge>
                </div>
                <div className="text-xs text-muted">{i.description} · production: {i.production}</div>
                {i.lastSyncAt && <div className="text-[11px] text-faint">Last sync {i.lastSyncAt.slice(0, 16).replace("T", " ")} — {i.lastSyncSummary}</div>}
              </div>
              <div className="flex shrink-0 gap-1.5">
                {i.status === "connected" ? (
                  <>
                    {i.kind !== "storage" && (
                      <Button size="sm" onClick={() => integration(i.kind, "sync")} disabled={!!busy}>
                        {busy === `${i.kind}:sync` ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync
                      </Button>
                    )}
                    {i.kind !== "storage" && (
                      <Button size="sm" variant="ghost" onClick={() => integration(i.kind, "disconnect")} disabled={!!busy}>
                        <Unplug /> Disconnect
                      </Button>
                    )}
                  </>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => integration(i.kind, "connect")} disabled={!!busy}>
                    <Plug /> Connect (mock)
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Agents" icon={<Bot />} subtitle="Each agent has a narrow responsibility and an explicit tool allowlist enforced by the registry." />
        <div className="grid gap-3 px-5 pb-5 md:grid-cols-2">
          {agents.map((a) => (
            <div key={a.name} className="rounded-lg border border-line bg-sunken p-3">
              <div className="font-mono text-sm text-accent">{a.name}</div>
              <div className="mt-0.5 text-xs text-muted">{a.description}</div>
              <div className="mt-2 flex flex-wrap gap-1">{a.tools.length ? a.tools.map((t) => <Badge key={t} className="font-mono">{t}</Badge>) : <span className="text-[11px] text-faint">LLM-only (no tools)</span>}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Tool registry (${tools.length})`} icon={<Wrench />} subtitle="Read tools run immediately. Write, external and destructive tools are queued for your approval (except low-risk derived artefacts marked auto)." />
        <div className="overflow-x-auto px-5 pb-5">
          <table className="w-full min-w-[560px] text-sm">
            <tbody className="divide-y divide-line">
              {tools.map((t) => (
                <tr key={t.name}>
                  <td className="py-2 pr-3 font-mono text-xs text-fg">{t.name}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={t.permission === "read" ? "neutral" : t.permission === "destructive" ? "danger" : "signal"}>{t.permission}</Badge>
                  </td>
                  <td className="py-2 pr-3 text-xs">{t.permission === "read" ? <span className="text-faint">immediate</span> : t.autoApprove ? <span className="text-muted">auto (derived)</span> : <span className="text-signal">needs approval</span>}</td>
                  <td className="py-2 text-xs text-muted">{t.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader title="Your data" icon={<Database />} />
        <div className="flex flex-wrap gap-2 px-5 pb-5">
          <a href="/api/account/export" className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-elev px-4 text-sm font-medium text-fg hover:bg-hover">
            <Download className="size-4" /> Export everything (JSON)
          </a>
          {isDemo && (
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={async () => {
                if (!window.confirm("Reset the demo workspace to its original state? All changes in the demo will be lost.")) return;
                setBusy("reset");
                try {
                  await apiFetch("/api/account/reset-demo", { body: { confirm: true } });
                  toast.success("Demo reset");
                  window.location.href = "/";
                } catch (e) {
                  toast.error((e as Error).message);
                  setBusy(null);
                }
              }}
            >
              {busy === "reset" ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reset demo workspace
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-faint">{hint}</p>}
    </div>
  );
}

function Info({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-sunken px-3 py-2">
      <div className="text-[11px] tracking-wide text-faint uppercase">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 text-sm text-fg">
        <span className={cn("size-1.5 rounded-full", ok ? "bg-success" : "bg-signal")} /> {value}
      </div>
    </div>
  );
}
