import { Elysia, t } from "elysia";
import { eq, ilike, or, asc } from "drizzle-orm";
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

export function duplicate(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505" ||
    typeof error === "object" && error !== null && "cause" in error &&
    typeof error.cause === "object" && error.cause !== null && "code" in error.cause && error.cause.code === "23505";
}

export type SongInput = typeof song.$inferInsert;

export const songStore = (db: Database) => ({
  find: async (search?: string) => {
    const term = search?.trim();
    const pattern = `%${(term ?? "").replace(/[\\%_]/g, "\\$&")}%`;
    return db.select().from(song).where(term ? or(ilike(song.key, pattern), ilike(song.title, pattern)) : undefined)
      .orderBy(asc(song.title), asc(song.key));
  },
  get: async (key: string) => (await db.select().from(song).where(eq(song.key, key)))[0],
  save: async (input: SongInput, previousKey?: string) => previousKey === undefined
    ? (await db.insert(song).values({ ...input, columns: input.columns ?? null, scale: input.scale ?? null }).returning())[0]
    : (await db.update(song).set({ ...input, columns: input.columns ?? null, scale: input.scale ?? null })
      .where(eq(song.key, previousKey)).returning())[0],
  remove: async (key: string) => (await db.delete(song).where(eq(song.key, key)).returning({ key: song.key }))[0],
});

export function songRoutes(db: Database) {
  const store = songStore(db);
  return new Elysia({ prefix: "/api/songs" })
    .get("/", async ({ query }) => {
      return { songs: await store.find(query.search) };
    }, { query: t.Object({ search: t.Optional(t.String()) }) })
    .get("/:key", async ({ params, status }) => {
      const found = await store.get(params.key);
      return found ? { song: found } : status(404, { error: "Song not found" });
    })
    .post("/", async ({ body, status }) => {
      try {
        const created = await store.save(body);
        return status(201, { song: created });
      } catch (error) {
        if (duplicate(error)) return status(409, { error: "Song key already exists" });
        throw error;
      }
    }, { body: payload })
    .put("/:key", async ({ params, body, status }) => {
      try {
        const updated = await store.save(body, params.key);
        return updated ? { song: updated } : status(404, { error: "Song not found" });
      } catch (error) {
        if (duplicate(error)) return status(409, { error: "Song key already exists" });
        throw error;
      }
    }, { body: payload })
    .delete("/:key", async ({ params, status }) => {
      const deleted = await store.remove(params.key);
      return deleted ? { deleted: deleted.key } : status(404, { error: "Song not found" });
    });
}
