import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { renderPdf, type Block, type Spec } from "@ruf/generator";
import type { Database } from "./db";
import type { createAuth } from "./auth";
import { bulletin, imageAsset, song } from "./schema";
import type { Composition } from "./drafts";

type Area = "cover" | "flow";
export type Location = { area: Area; index: number; type: string; itemIndex?: number };
export class PdfError extends Error {
  constructor(message: string, readonly block: Location) { super(message); }
}
export class PdfGenerationError extends Error {}

const label = (area: Area, index: number, type: string) => `${area === "cover" ? "Cover" : "Reading order"} block ${index + 1} (${type})`;
function fail(location: Location, reason: string): never {
  throw new PdfError(`${label(location.area, location.index, location.type)}: ${reason}`, location);
}

function positiveSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// The persisted composition describes reading order, not PDFKit columns or pages.
async function toSpec(db: Database, composition: Composition, date: string) {
  const assets: Record<string, Buffer> = Object.create(null);
  const songs: Record<string, { title: string; parts: { text: string; label?: string; style?: string }[]; columns?: number; scale?: number }> = Object.create(null);
  const asset = async (id: unknown, location: Location) => {
    if (typeof id !== "string" || !id.trim()) return fail(location, "Choose an image asset.");
    const [row] = await db.select().from(imageAsset).where(eq(imageAsset.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "00000000-0000-0000-0000-000000000000"));
    if (!row) return fail(location, `Image asset '${id}' is unavailable.`);
    if (!Buffer.isBuffer(row.bytes) || !row.bytes.length) return fail(location, `Image asset '${id}' is unavailable.`);
    try {
      // Decode and normalize uploaded images in memory from Postgres bytes so
      // corrupt assets fail at this location rather than inside PDFKit. Paper
      // shows the first frame of an animated image.
      assets[id] = await sharp(row.bytes, { animated: false, limitInputPixels: 20_000_000 }).png().toBuffer();
    } catch {
      return fail(location, `Image asset '${id}' cannot be decoded for PDF output.`);
    }
    return id;
  };
  const convertBlock = async (area: Area, index: number, block: Composition[Area][number]): Promise<Block> => {
    const location = { area, index, type: block.type };
    const invalid = (reason: string): never => fail(location, reason);
    switch (block.type) {
      case "heading":
        if (typeof block.title !== "string" || !block.title.trim()) return invalid("Enter heading text.");
        return { type: "heading", text: block.title };
      case "text":
        if (typeof block.text !== "string" || !block.text.trim()) return invalid("Enter text.");
        return { type: "text", text: block.text };
      case "scripture":
        if (block.role !== "sermon" && block.role !== "reading") return invalid("Choose Sermon passage or Scripture reading.");
        if (typeof block.reference !== "string" || !block.reference.trim() || typeof block.text !== "string" || !block.text.trim()) return invalid("Enter a reference and passage text.");
        return { type: "scripture", label: block.role === "sermon" ? "Sermon Passage" : "Scripture Reading", reference: block.reference, text: block.text };
      case "announcements": {
        if (block.title !== undefined && typeof block.title !== "string") return invalid("Enter a valid announcement heading.");
        if (!Array.isArray(block.items)) return invalid("Announcement items must be a list.");
        const items = block.items.map((item, itemIndex) => {
          if (!item || typeof item !== "object" || item.title !== undefined && typeof item.title !== "string" || item.text !== undefined && typeof item.text !== "string" || !`${item.title ?? ""}${item.text ?? ""}`.trim()) {
            return invalid(`Announcement item ${itemIndex + 1} needs a title or text.`);
          }
          return { title: item.title ?? "", text: item.text ?? "" };
        });
        return { type: "announcements", title: block.title || "Announcements", items };
      }
      case "song": {
        if (typeof block.songKey !== "string" || !block.songKey.trim()) return invalid("Choose a song key.");
        const [row] = await db.select().from(song).where(eq(song.key, block.songKey));
        if (!row) return invalid(`Song key '${block.songKey}' was not found in the song store.`);
        songs[block.songKey] = { title: row.title, parts: row.parts, ...(row.columns == null ? {} : { columns: row.columns }), ...(row.scale == null ? {} : { scale: row.scale }) };
        return { type: "song", song_ref: block.songKey };
      }
      case "image": case "branding": return { type: block.type, path: await asset(block.assetId, location) };
      case "qr": {
        if (!Array.isArray(block.items) || !block.items.length) return invalid("Add at least one QR code.");
        // Current folded A4 column: (297 mm - two 7 mm margins - 14 mm gutter) / 2.
        // PDFKit otherwise clamps each requested QR size to a microscopic item width.
        const itemWidthMm = (134.5 - 4 * (block.items.length - 1)) / block.items.length;
        const items: { path: string; caption?: string; size_mm?: number }[] = [];
        for (const [itemIndex, item] of block.items.entries()) {
          const itemLocation = { ...location, itemIndex };
          if (!item || typeof item !== "object" || Array.isArray(item)) return fail(itemLocation, `QR item ${itemIndex + 1} is invalid.`);
          if (item.caption !== undefined && typeof item.caption !== "string") return fail(itemLocation, `QR item ${itemIndex + 1} needs a valid caption.`);
          if (item.size_mm !== undefined && !positiveSize(item.size_mm)) return fail(itemLocation, `QR item ${itemIndex + 1} size must be positive.`);
          if (itemWidthMm < (item.size_mm ?? 28)) return fail(itemLocation, `QR item ${itemIndex + 1} does not fit at its requested size on the folded A4 sheet. Reduce its size or split the QR block.`);
          items.push({ path: await asset(item.assetId, itemLocation), ...(item.caption === undefined ? {} : { caption: item.caption }), ...(item.size_mm === undefined ? {} : { size_mm: item.size_mm }) });
        }
        return { type: "qr", items };
      }
      case "contacts": {
        if (!Array.isArray(block.items)) return invalid("Contact items must be a list.");
        const items = block.items.map((item, itemIndex) => {
          if (!item || typeof item !== "object" || Array.isArray(item) || item.name !== undefined && typeof item.name !== "string" || item.detail !== undefined && typeof item.detail !== "string" || !`${item.name ?? ""}${item.detail ?? ""}`.trim()) return invalid(`Contact item ${itemIndex + 1} needs a name or detail.`);
          return { name: item.name ?? "", detail: item.detail ?? "" };
        });
        return { type: "contacts", items };
      }
      case "spacer":
        if (block.height_mm !== undefined && !positiveSize(block.height_mm)) return invalid("Spacer height must be positive.");
        return { type: "spacer", ...(block.height_mm === undefined ? {} : { height_mm: block.height_mm }) };
      default: return invalid("This block is not supported in PDF generation. Your draft is unchanged.");
    }
  };
  const convert = async (area: Area): Promise<Block[]> => {
    const blocks: Block[] = [];
    for (const [index, block] of composition[area].entries()) {
      blocks.push(await convertBlock(area, index, block));
    }
    return blocks;
  };
  const spec: Spec = {
    metadata: { title: `RUF Bulletin — ${date}`, subject: `Gathering on ${date}`, date },
    cover: [...await convert("cover"), { type: "heading", style: "right", text: new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`)) }],
    flow: await convert("flow"),
  };
  return { spec, assets, songs };
}

/** Shared PDF service for HTTP and MCP: authenticated callers supply a persisted bulletin ID. */
export async function renderPersistedBulletinPdf(db: Database, id: string): Promise<{ bytes: Buffer; date: string } | undefined> {
  const [row] = await db.select().from(bulletin).where(eq(bulletin.id, id));
  if (!row) return undefined;
  return { bytes: await renderDatedPdf(db, JSON.parse(row.composition) as Composition, row.gatheringDate), date: row.gatheringDate };
}

/** Also usable when a caller already holds a persisted composition and its gathering date. */
export async function renderDatedPdf(db: Database, composition: Composition, date: string): Promise<Buffer> {
  const { spec, assets, songs } = await toSpec(db, composition, date);
  const options = { assets, songStore: { songs } };
  try { return await renderPdf(spec, options); }
  catch (error) {
    // The folded layout can only contain three reading-order panels and one cover.
    // Locate the first prefix that fails to fit at the generator's minimum scale.
    const message = error instanceof Error ? error.message : "PDF generation failed";
    if (message.includes("does not fit")) {
      for (const area of ["cover", "flow"] as const) {
        for (let index = 0; index < spec[area]!.length; index++) {
          const prefix = { ...spec, [area]: spec[area]!.slice(0, index + 1), ...(area === "cover" ? { flow: [] } : {}) };
          try { await renderPdf(prefix, options); }
          catch (failure) {
            if (failure instanceof Error && failure.message.includes("does not fit")) {
              const locationIndex = area === "cover" ? Math.min(index, composition.cover.length - 1) : index;
              const type = composition[area][locationIndex]?.type ?? "date";
              throw new PdfError(`${area === "cover" ? "Cover" : "Reading order"} block ${locationIndex + 1} (${type}) does not fit on the folded A4 sheet${area === "cover" && index !== locationIndex ? " alongside the gathering date" : ""}. Shorten or move this content.`, { area, index: locationIndex, type });
            }
            throw failure;
          }
        }
      }
    }
    // An aggregate fit failure may not have a uniquely attributable block.
    // It is still a generation error, never a server crash or a partial PDF.
    if (message.includes("does not fit")) {
      throw new PdfGenerationError("Bulletin content does not fit on the folded A4 sheet. Shorten or rearrange the cover and reading-order blocks.");
    }
    throw error;
  }
}

export function pdfRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  return new Elysia({ prefix: "/api/bulletins" })
    .get("/:id/pdf", async ({ request, params, query, set }) => {
      if (!await auth.api.getSession({ headers: request.headers })) { set.status = 401; return { error: "Sign in required" }; }
      try {
        const rendered = await renderPersistedBulletinPdf(db, params.id);
        if (!rendered) { set.status = 404; return { error: "Bulletin not found" }; }
        return new Response(new Uint8Array(rendered.bytes), { headers: {
          "content-type": "application/pdf",
          "content-disposition": `${query.download === "1" ? "attachment" : "inline"}; filename="ruf-bulletin-${rendered.date}.pdf"`,
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
        } });
      } catch (error) {
        if (!(error instanceof PdfError || error instanceof PdfGenerationError)) throw error;
        set.status = 422;
        return { error: error.message, ...(error instanceof PdfError ? { block: error.block } : {}) };
      }
    }, { query: t.Object({ download: t.Optional(t.String()) }) });
}
