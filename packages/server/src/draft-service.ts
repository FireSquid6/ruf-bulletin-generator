import { and, asc, eq, sql } from "drizzle-orm";
import type { Database } from "./db";
import { bulletin } from "./schema";

// A bulletin is an ordered composition, independent of its current PDF format.
export type Composition = { cover: Array<{ type: string; [key: string]: unknown }>; flow: Array<{ type: string; [key: string]: unknown }> };
export type Draft = { id: string; gatheringDate: string; revision: number; composition: Composition };
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

export class DraftError extends Error {
  constructor(readonly status: 400 | 404 | 409, message: string, readonly latest?: Draft) { super(message); }
  toJSON() { return { error: this.message, ...(this.latest ? { latest: this.latest } : {}) }; }
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}
function validComposition(value: unknown): value is Composition {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const content = value as Record<string, unknown>;
  return [content.cover, content.flow].every((blocks) => Array.isArray(blocks) && blocks.every((block) => {
    if (!block || typeof block !== "object" || Array.isArray(block) || typeof block.type !== "string" || !block.type) return false;
    if (block.type === "song") return typeof block.songKey === "string" && Object.keys(block).every((key) => key === "type" || key === "songKey");
    return true;
  }));
}
function uniqueViolation(error: unknown) {
  const dbError = error as { code?: string; cause?: { code?: string } } | null;
  return dbError?.code === "23505" || dbError?.cause?.code === "23505";
}
function detail(row: typeof bulletin.$inferSelect): Draft {
  return { id: row.id, gatheringDate: row.gatheringDate, revision: row.revision, composition: JSON.parse(row.composition) as Composition };
}

export function draftStore(db: Database) {
  const get = async (id: string) => {
    const [row] = await db.select().from(bulletin).where(eq(bulletin.id, id));
    return row ? detail(row) : undefined;
  };
  return {
    get,
    async list(date?: string) {
      if (date && !validDate(date)) throw new DraftError(400, "Enter a valid gathering date");
      return db.select({ id: bulletin.id, gatheringDate: bulletin.gatheringDate, revision: bulletin.revision })
        .from(bulletin).where(date ? eq(bulletin.gatheringDate, date) : undefined).orderBy(asc(bulletin.gatheringDate));
    },
    async create(gatheringDate: string) {
      if (!validDate(gatheringDate)) throw new DraftError(400, "Enter a valid gathering date");
      try {
        const [row] = await db.insert(bulletin).values({ id: crypto.randomUUID(), gatheringDate, composition: JSON.stringify(starterComposition()) }).returning();
        return detail(row);
      } catch (error) {
        if (!uniqueViolation(error)) throw error;
        throw new DraftError(409, "A bulletin already exists for this date");
      }
    },
    async save(id: string, input: { gatheringDate: string; revision: number; composition: unknown }) {
      if (!validDate(input.gatheringDate) || !Number.isInteger(input.revision) || input.revision < 1 || !validComposition(input.composition)) {
        throw new DraftError(400, "Enter a valid date, revision and composition");
      }
      try {
        const [row] = await db.update(bulletin).set({ gatheringDate: input.gatheringDate, composition: JSON.stringify(input.composition), revision: sql`${bulletin.revision} + 1` })
          .where(and(eq(bulletin.id, id), eq(bulletin.revision, input.revision))).returning();
        if (row) return detail(row);
        const latest = await get(id);
        throw latest ? new DraftError(409, "This bulletin has a newer revision.", latest) : new DraftError(404, "Bulletin not found");
      } catch (error) {
        if (error instanceof DraftError || !uniqueViolation(error)) throw error;
        const latest = await get(id);
        if (latest && latest.revision !== input.revision) throw new DraftError(409, "This bulletin has a newer revision.", latest);
        throw new DraftError(409, "A bulletin already exists for this date");
      }
    },
    async remove(id: string) {
      const [row] = await db.delete(bulletin).where(eq(bulletin.id, id)).returning({ id: bulletin.id });
      if (!row) throw new DraftError(404, "Bulletin not found");
      return row.id;
    },
  };
}
