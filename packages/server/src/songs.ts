import { Elysia, t } from "elysia";
import { eq, ilike, or, asc } from "drizzle-orm";
import type { createAuth } from "./auth";
import type { Database } from "./db";
import { song } from "./schema";

const payload = t.Object({
  key: t.String({ minLength: 1, pattern: "\\S" }),
  title: t.String({ minLength: 1, pattern: "\\S" }),
  parts: t.Array(t.Object({
    text: t.String({ minLength: 1, pattern: "\\S" }),
    label: t.Optional(t.String()),
    style: t.Optional(t.Literal("chorus")),
  }), { minItems: 1 }),
  columns: t.Optional(t.Nullable(t.Union([t.Literal(1), t.Literal(2)]))),
  scale: t.Optional(t.Nullable(t.Number({ minimum: 0, exclusiveMinimum: 0 }))),
});

function duplicate(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505" ||
    typeof error === "object" && error !== null && "cause" in error &&
    typeof error.cause === "object" && error.cause !== null && "code" in error.cause && error.cause.code === "23505";
}

export function songRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  return new Elysia({ prefix: "/api/songs" })
    .resolve(async ({ request, status }) => {
      if (!await auth.api.getSession({ headers: request.headers })) return status(401, { error: "Sign in required" });
      return {};
    })
    .get("/", async ({ query }) => {
      const search = query.search?.trim();
      const pattern = `%${(search ?? "").replace(/[\\%_]/g, "\\$&")}%`;
      return { songs: await db.select().from(song)
        .where(search ? or(ilike(song.key, pattern), ilike(song.title, pattern)) : undefined)
        .orderBy(asc(song.title), asc(song.key)) };
    }, { query: t.Object({ search: t.Optional(t.String()) }) })
    .get("/:key", async ({ params, status }) => {
      const [found] = await db.select().from(song).where(eq(song.key, params.key));
      return found ? { song: found } : status(404, { error: "Song not found" });
    })
    .post("/", async ({ body, status }) => {
      try {
        const [created] = await db.insert(song).values({ ...body, columns: body.columns ?? null, scale: body.scale ?? null }).returning();
        return status(201, { song: created });
      } catch (error) {
        if (duplicate(error)) return status(409, { error: "Song key already exists" });
        throw error;
      }
    }, { body: payload })
    .put("/:key", async ({ params, body, status }) => {
      try {
        const [updated] = await db.update(song).set({ ...body, columns: body.columns ?? null, scale: body.scale ?? null })
          .where(eq(song.key, params.key)).returning();
        return updated ? { song: updated } : status(404, { error: "Song not found" });
      } catch (error) {
        if (duplicate(error)) return status(409, { error: "Song key already exists" });
        throw error;
      }
    }, { body: payload })
    .delete("/:key", async ({ params, status }) => {
      const [deleted] = await db.delete(song).where(eq(song.key, params.key)).returning({ key: song.key });
      return deleted ? { deleted: deleted.key } : status(404, { error: "Song not found" });
    });
}
