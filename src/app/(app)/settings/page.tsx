import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { getViewer } from "@/server/services/context";
import { aiStatus } from "@/server/ai/llm";
import { getEmbeddingProvider } from "@/server/ai/embeddings";
import { dbDriver } from "@/server/db/client";
import { CATALOG } from "@/server/integrations";
import { listTools } from "@/server/tools/registry";
import "@/server/tools/definitions";
import { AGENTS } from "@/server/agents/agents";
import { PageHeader } from "@/components/ui/primitives";
import { SettingsForms } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { db, user } = await getViewer();
  const [[profile], [settings], integrations] = await Promise.all([
    db.select({ name: s.users.name, headline: s.users.headline, email: s.users.email }).from(s.users).where(eq(s.users.id, user.id)),
    db.select().from(s.userSettings).where(eq(s.userSettings.userId, user.id)),
    db.select().from(s.integrations).where(eq(s.integrations.userId, user.id)),
  ]);
  const ai = aiStatus();
  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader eyebrow="System" title="Settings" description="Profile, reasoning behaviour, integrations and your data." />
      <SettingsForms
        isDemo={user.isDemo}
        profile={{ name: profile.name, headline: profile.headline ?? "", email: profile.email }}
        settings={{ aiMode: settings?.aiMode ?? "auto", focusHoursPerWeek: settings?.focusHoursPerWeek ?? 25, followUpDays: settings?.followUpDays ?? 5, neglectDays: settings?.neglectDays ?? 10, hourlyValueEstimate: settings?.hourlyValueEstimate ?? 20 }}
        system={{ ai, embeddings: getEmbeddingProvider().name, db: dbDriver() }}
        integrations={CATALOG.map((c) => {
          const row = integrations.find((i) => i.kind === c.kind);
          return { ...c, status: row?.status ?? "disconnected", lastSyncAt: row?.lastSyncAt?.toISOString() ?? null, lastSyncSummary: row?.lastSyncSummary ?? null };
        })}
        tools={listTools().map((t) => ({ name: t.name, description: t.description, permission: t.permission, autoApprove: t.autoApprove, risk: t.risk }))}
        agents={Object.values(AGENTS).map((a) => ({ name: a.name, description: a.description, tools: a.tools, responsibilities: a.responsibilities }))}
      />
    </div>
  );
}
