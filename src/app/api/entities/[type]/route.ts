import { z } from "zod";
import { api, ApiError } from "@/server/security/api";
import { CRUD_TYPES, createEntity, type CrudType } from "@/server/services/entities";

export const POST = api({ body: z.unknown() }, async ({ db, user, params, body }) => {
  if (!CRUD_TYPES.includes(params.type as CrudType)) throw new ApiError(404, "Unknown entity type");
  try {
    return { entity: await createEntity(db, user.id, params.type as CrudType, body) };
  } catch (e) {
    if (e instanceof z.ZodError) throw new ApiError(400, e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    throw new ApiError(400, (e as Error).message);
  }
});
