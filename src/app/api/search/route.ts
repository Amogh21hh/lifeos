import { z } from "zod";
import { api, ApiError } from "@/server/security/api";
import { loadWorld } from "@/server/engine/world";
import { hybridSearch } from "@/server/search/search";

export const GET = api({}, async ({ db, user, req }) => {
  const q = z.string().trim().min(1).max(300).safeParse(req.nextUrl.searchParams.get("q"));
  if (!q.success) throw new ApiError(400, "Query required");
  const started = performance.now();
  const res = await hybridSearch(db, await loadWorld(db, user.id), q.data, { limit: 25 });
  return { ...res, ms: Math.round(performance.now() - started) };
});
