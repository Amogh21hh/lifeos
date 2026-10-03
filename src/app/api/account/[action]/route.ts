import { eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api, ApiError } from "@/server/security/api";
import { resetDemo } from "@/server/db/seed";
import { createSession } from "@/server/auth/session";
import { listTools } from "@/server/tools/registry";
import "@/server/tools/definitions";

/** Data portability: everything LIFEOS stores about the user, as JSON. */
export const GET = api({}, async ({ db, user, params }) => {
  if (params.action === "tools") return { tools: listTools() };
  if (params.action !== "export") throw new ApiError(404, "Unknown action");
  const uid = user.id;
  const pick = async <T extends { userId: unknown }>(t: T) => db.select().from(t as never).where(eq((t as unknown as { userId: never }).userId, uid as never));
  const data = {
    exportedAt: new Date().toISOString(),
    user: (await db.select({ id: s.users.id, email: s.users.email, name: s.users.name, headline: s.users.headline, createdAt: s.users.createdAt }).from(s.users).where(eq(s.users.id, uid)))[0],
    goals: await pick(s.goals),
    projects: await pick(s.projects),
    tasks: await pick(s.tasks),
    people: await pick(s.people),
    companies: await pick(s.companies),
    opportunities: await pick(s.opportunities),
    applications: await pick(s.applications),
    skills: await pick(s.skills),
    decisions: await pick(s.decisions),
    memories: await pick(s.memories),
    documents: (await db.select().from(s.documents).where(eq(s.documents.userId, uid))).map(({ storageKey: _k, ...d }) => d),
    documentFields: await pick(s.documentFields),
    transactions: await pick(s.transactions),
    accounts: await pick(s.accounts),
    commitments: await pick(s.commitments),
    messages: await pick(s.messages),
    links: await pick(s.links),
    activities: await pick(s.activities),
    aiRuns: await pick(s.aiRuns),
    toolCalls: await pick(s.toolCalls),
    approvals: await pick(s.approvals),
  };
  return new Response(JSON.stringify(data, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="lifeos-export-${new Date().toISOString().slice(0, 10)}.json"` } });
});

export const POST = api({ limit: "auth", body: z.object({ confirm: z.literal(true) }) }, async ({ db, user, params }) => {
  if (params.action !== "reset-demo") throw new ApiError(404, "Unknown action");
  if (!user.isDemo) throw new ApiError(403, "Only the demo workspace can be reset");
  const userId = await resetDemo(db);
  await createSession(userId);
  return { ok: true };
});
