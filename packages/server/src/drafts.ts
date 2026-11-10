import { Elysia, t } from "elysia";
import type { Database } from "./db";
import { createAuth } from "./auth";
import { DraftError, draftStore } from "./draft-service";
export { starterComposition, STARTER_LOGO_ASSET_ID } from "./draft-service";
export type { Composition } from "./draft-service";

export function draftRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  const drafts = draftStore(db);
  const result = async <T>(operation: () => Promise<T>, set: { status?: number | string }) => {
    try { return await operation(); }
    catch (error) {
      if (!(error instanceof DraftError)) throw error;
      set.status = error.status;
      return error.toJSON();
    }
  };
  return new Elysia({ prefix: "/api/bulletins" })
    .derive(async ({ request }) => ({ staff: await auth.api.getSession({ headers: request.headers }) }))
    .get("/", async ({ staff, query, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      return result(async () => ({ bulletins: await drafts.list(query.date) }), set);
    }, { query: t.Object({ date: t.Optional(t.String()) }) })
    .post("/", async ({ staff, body, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      return result(async () => { const bulletin = await drafts.create(body.gatheringDate); set.status = 201; return bulletin; }, set);
    }, { body: t.Object({ gatheringDate: t.String() }) })
    .get("/:id", async ({ staff, params, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      return result(async () => { const draft = await drafts.get(params.id); if (!draft) throw new DraftError(404, "Bulletin not found"); return draft; }, set);
    })
    .put("/:id", async ({ staff, body, params, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      return result(() => drafts.save(params.id, body), set);
    }, { body: t.Object({ gatheringDate: t.String(), revision: t.Number(), composition: t.Any() }) })
    .delete("/:id", async ({ staff, params, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      return result(async () => { await drafts.remove(params.id); set.status = 204; }, set);
    });
}
