import { z } from "zod";
import { api, ApiError } from "@/server/security/api";
import { CRUD_TYPES, deleteEntity, patchEntity, type CrudType } from "@/server/services/entities";

function check(params: Record<string, string>) {
  if (!CRUD_TYPES.includes(params.type as CrudType)) throw new ApiError(404, "Unknown entity type");
  if (!z.string().uuid().safeParse(params.id).success) throw new ApiError(400, "Invalid id");
  return { type: params.type as CrudType, id: params.id };
}

export const PATCH = api({ body: z.unknown() }, async ({ db, user, params, body }) => {
  const { type, id } = check(params);
  try {
    return { entity: await patchEntity(db, user.id, type, id, body) };
  } catch (e) {
    if (e instanceof z.ZodError) throw new ApiError(400, e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw new ApiError((e as Error).message === "Not found" ? 404 : 400, (e as Error).message);
  }
});

/** Direct user deletion; the UI always asks for confirmation first. */
export const DELETE = api({}, async ({ db, user, params }) => {
  const { type, id } = check(params);
  try {
    return await deleteEntity(db, user.id, type, id);
  } catch (e) {
    throw new ApiError(404, (e as Error).message);
  }
});
