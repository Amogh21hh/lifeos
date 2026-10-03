import { eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api } from "@/server/security/api";
import { runCommand } from "@/server/agents/orchestrator";

export const maxDuration = 120;

export const POST = api(
  {
    limit: "ai",
    body: z.object({
      text: z.string().trim().min(1).max(1000),
      context: z.object({ entityType: z.string().max(30), entityId: z.string().uuid() }).optional(),
    }),
  },
  async ({ db, user, body }) => {
    const [settings] = await db.select({ aiMode: s.userSettings.aiMode }).from(s.userSettings).where(eq(s.userSettings.userId, user.id));
    return runCommand(db, user.id, body.text, { aiMode: (settings?.aiMode as "auto" | "local") ?? "auto", context: body.context });
  },
);
