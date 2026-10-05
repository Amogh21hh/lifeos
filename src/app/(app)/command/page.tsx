import type { Metadata } from "next";
import { and, desc, eq } from "drizzle-orm";
import * as s from "@/server/db/schema";
import { getViewer } from "@/server/services/context";
import { PageHeader } from "@/components/ui/primitives";
import { CommandCenter } from "./command-center";

export const metadata: Metadata = { title: "Command Center" };

export default async function CommandPage(props: PageProps<"/command">) {
  const sp = await props.searchParams;
  const { db, user } = await getViewer();
  const history = await db
    .select({ id: s.aiRuns.id, intent: s.aiRuns.intent, input: s.aiRuns.input, createdAt: s.aiRuns.createdAt, status: s.aiRuns.status })
    .from(s.aiRuns)
    .where(and(eq(s.aiRuns.userId, user.id)))
    .orderBy(desc(s.aiRuns.createdAt))
    .limit(40);
  const recent = history
    .map((h) => {
      const input = h.input as Record<string, unknown> | null;
      const text = (input?.query ?? input?.question ?? input?.text ?? input?.objective) as string | undefined;
      return text && typeof text === "string" ? text : null;
    })
    .filter((t, i, arr): t is string => !!t && arr.indexOf(t) === i)
    .slice(0, 8);
  const q = typeof sp.q === "string" ? sp.q : "";
  const ctx = typeof sp.ctx === "string" && /^[a-z]+:[0-9a-f-]{36}$/.test(sp.ctx) ? { entityType: sp.ctx.split(":")[0], entityId: sp.ctx.split(":")[1] } : undefined;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Command Center" title="Tell LIFEOS what you need" description="Natural language is routed to a specialised agent, which uses permissioned tools over your data. Anything that changes records, leaves the system or deletes data waits for your approval." />
      <CommandCenter initialQuery={q} context={ctx} recent={recent} />
    </div>
  );
}
