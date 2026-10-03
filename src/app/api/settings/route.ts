import { eq } from "drizzle-orm";
import { z } from "zod";
import * as s from "@/server/db/schema";
import { api } from "@/server/security/api";

export const PATCH = api(
  {
    body: z.object({
      name: z.string().trim().min(1).max(80).optional(),
      headline: z.string().max(200).optional(),
      aiMode: z.enum(["auto", "local"]).optional(),
      focusHoursPerWeek: z.number().int().min(1).max(100).optional(),
      followUpDays: z.number().int().min(1).max(60).optional(),
      neglectDays: z.number().int().min(2).max(120).optional(),
      hourlyValueEstimate: z.number().min(0).max(10000).optional(),
    }),
  },
  async ({ db, user, body }) => {
    const { name, headline, ...settings } = body;
    if (name || headline !== undefined) await db.update(s.users).set({ ...(name ? { name } : {}), ...(headline !== undefined ? { headline } : {}) }).where(eq(s.users.id, user.id));
    if (Object.keys(settings).length)
      await db
        .insert(s.userSettings)
        .values({ userId: user.id, ...settings })
        .onConflictDoUpdate({ target: s.userSettings.userId, set: { ...settings, updatedAt: new Date() } });
    return { ok: true };
  },
);
