import { z } from "zod";
import { api, ApiError } from "@/server/security/api";
import { resolveApproval } from "@/server/tools/registry";
import "@/server/tools/definitions";

export const POST = api({ limit: "ai", body: z.object({ decision: z.enum(["approve", "reject"]) }) }, async ({ db, user, body, params }) => {
  if (!z.string().uuid().safeParse(params.id).success) throw new ApiError(400, "Invalid id");
  try {
    const r = await resolveApproval(db, user.id, params.id, body.decision);
    return { status: r.status, error: "result" in r && r.result && "error" in r.result ? r.result.error : undefined };
  } catch (e) {
    throw new ApiError(409, (e as Error).message);
  }
});
