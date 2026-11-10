import { Elysia, t } from "elysia";
import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "./db";
import { bulletin } from "./schema";
import { createAuth } from "./auth";

// Content is a document of ordered, movable blocks, not a serialized PDF page.
export type Composition = { cover: Array<{ type: string; [key: string]: unknown }>; flow: Array<{ type: string; [key: string]: unknown }> };
// Seeded by migration 0004_assets; the ID remains a reference, never image bytes.
export const STARTER_LOGO_ASSET_ID = "00000000-0000-4000-8000-000000000004";
export const starterComposition = (): Composition => ({
  cover: [
    { type: "branding", assetId: STARTER_LOGO_ASSET_ID },
    { type: "announcements", title: "Announcements", items: [] },
    { type: "contacts", items: [] },
  ],
  flow: [
    { type: "scripture", role: "sermon", reference: "", text: "" },
    { type: "scripture", role: "reading", reference: "", text: "" },
    { type: "song", songKey: "" },
    { type: "qr", items: [] },
  ],
});

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function validComposition(value: unknown): value is Composition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = value as Record<string, unknown>;
  return [content.cover, content.flow].every((blocks) => Array.isArray(blocks) && blocks.every((block) =>
    block && typeof block === "object" && !Array.isArray(block) && typeof block.type === "string" && block.type.length > 0));
}
function uniqueViolation(error: unknown) {
  const dbError = error as { code?: string; cause?: { code?: string } } | null;
  return dbError?.code === "23505" || dbError?.cause?.code === "23505";
}
function detail(row: typeof bulletin.$inferSelect) {
  return { id: row.id, gatheringDate: row.gatheringDate, revision: row.revision, composition: JSON.parse(row.composition) as Composition };
}

export function draftRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  return new Elysia({ prefix: "/api/bulletins" })
    .derive(async ({ request }) => ({ staff: await auth.api.getSession({ headers: request.headers }) }))
    .get("/", async ({ staff, query, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      if (query.date && !validDate(query.date)) { set.status = 400; return { error: "Enter a valid gathering date" }; }
      const rows = await db.select({ id: bulletin.id, gatheringDate: bulletin.gatheringDate, revision: bulletin.revision })
        .from(bulletin).where(query.date ? eq(bulletin.gatheringDate, query.date) : undefined)
        .orderBy(asc(bulletin.gatheringDate));
      return { bulletins: rows };
    }, { query: t.Object({ date: t.Optional(t.String()) }) })
    .post("/", async ({ staff, body, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      if (!validDate(body.gatheringDate)) { set.status = 400; return { error: "Enter a valid gathering date" }; }
      try {
        const [row] = await db.insert(bulletin).values({ id: crypto.randomUUID(), gatheringDate: body.gatheringDate, composition: JSON.stringify(starterComposition()) }).returning();
        set.status = 201;
        return detail(row);
      } catch (error) {
        if (!uniqueViolation(error)) throw error;
        set.status = 409;
        return { error: "A bulletin already exists for this date" };
      }
    }, { body: t.Object({ gatheringDate: t.String() }) })
    .get("/:id", async ({ staff, params, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      const [row] = await db.select().from(bulletin).where(eq(bulletin.id, params.id));
      if (!row) { set.status = 404; return { error: "Bulletin not found" }; }
      return detail(row);
    })
    .put("/:id", async ({ staff, body, params, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      if (!validDate(body.gatheringDate) || !Number.isInteger(body.revision) || body.revision < 1 || !validComposition(body.composition)) {
        set.status = 400; return { error: "Enter a valid date, revision and composition" };
      }
      try {
        const [row] = await db.update(bulletin).set({ gatheringDate: body.gatheringDate, composition: JSON.stringify(body.composition), revision: sql`${bulletin.revision} + 1` })
          .where(and(eq(bulletin.id, params.id), eq(bulletin.revision, body.revision))).returning();
        if (row) return detail(row);
        const [existing] = await db.select().from(bulletin).where(eq(bulletin.id, params.id));
        set.status = existing ? 409 : 404;
        return existing ? { error: "This bulletin has a newer revision.", latest: detail(existing) } : { error: "Bulletin not found" };
      } catch (error) {
        if (!uniqueViolation(error)) throw error;
        // A simultaneous date change may have advanced this draft too. Report
        // that newer state before treating the requested date as the conflict.
        const [existing] = await db.select().from(bulletin).where(eq(bulletin.id, params.id));
        if (existing && existing.revision !== body.revision) {
          set.status = 409;
          return { error: "This bulletin has a newer revision.", latest: detail(existing) };
        }
        set.status = 409;
        return { error: "A bulletin already exists for this date" };
      }
    }, { body: t.Object({ gatheringDate: t.String(), revision: t.Number(), composition: t.Any() }) })
    .delete("/:id", async ({ staff, params, set }) => {
      if (!staff) { set.status = 401; return { error: "Sign in required" }; }
      const [row] = await db.delete(bulletin).where(eq(bulletin.id, params.id)).returning({ id: bulletin.id });
      if (!row) { set.status = 404; return { error: "Bulletin not found" }; }
      set.status = 204;
    });
}
