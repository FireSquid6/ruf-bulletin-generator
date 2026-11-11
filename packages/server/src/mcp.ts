import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Database } from "./db";
import { AssetError, assetStore, assetLimit, metadata } from "./assets";
import { duplicate, songStore } from "./songs";
import { DraftError, draftStore } from "./draft-service";
import { PdfError, PdfGenerationError, renderPersistedBulletinPdf } from "./pdf";

const part = z.object({ text: z.string().trim().min(1), label: z.string().optional(), style: z.literal("chorus").optional() });
const songInput = z.object({
  key: z.string().min(1).regex(/\S/), title: z.string().min(1).regex(/\S/),
  parts: z.array(part).min(1), columns: z.union([z.literal(1), z.literal(2)]).nullish(),
  scale: z.number().positive().nullish(),
});
const uuid = z.uuid();

const success = (value: Record<string, unknown>) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value });
const failure = (message: string) => ({ isError: true, content: [{ type: "text" as const, text: message }] });
const draftFailure = (error: DraftError) => {
  const value = { status: error.status, ...error.toJSON() };
  return { ...success(value), isError: true };
};
class ToolError extends Error {}
const safe = async (operation: () => Promise<Record<string, unknown>>) => {
  try { return success(await operation()); }
  catch (error) {
    if (duplicate(error)) return failure("Song key already exists");
    // Validation is done by SDK schemas and the shared asset validator.
    if (error instanceof AssetError || error instanceof ToolError) return failure(error.message);
    throw error;
  }
};

/** Register content tools on a fresh server for each HTTP request. #16 can register bulletin tools here. */
export function registerLibraryTools(server: McpServer, db: Database) {
  const songs = songStore(db);
  const assets = assetStore(db);
  server.registerTool("find_songs", { description: "Search song keys and titles in the shared song store", inputSchema: z.object({ search: z.string().optional() }) },
    async ({ search }) => success({ songs: await songs.find(search) }));
  server.registerTool("get_song", { description: "Look up a song by its key", inputSchema: z.object({ key: z.string() }) },
    async ({ key }) => { const song = await songs.get(key); return song ? success({ song }) : failure("Song not found"); });
  server.registerTool("save_song", { description: "Add or edit a song, its ordered verse/chorus parts and defaults. Supply previousKey to edit or rename; renaming leaves bulletin references to the old key broken until that key is reused.", inputSchema: songInput.extend({ previousKey: z.string().optional() }) },
    async ({ previousKey, ...input }) => safe(async () => {
      const song = await songs.save({ ...input, columns: input.columns ?? null, scale: input.scale ?? null }, previousKey);
      if (!song) throw new ToolError("Song not found");
      return { song };
    }));
  server.registerTool("delete_song", { description: "Remove a song; bulletin song keys are not changed", inputSchema: z.object({ key: z.string() }) },
    async ({ key }) => { const deleted = await songs.remove(key); return deleted ? success({ deleted: deleted.key }) : failure("Song not found"); });
  server.registerTool("list_assets", { description: "List reusable branding, image and QR asset metadata", inputSchema: z.object({}) },
    async () => success({ assets: await assets.list() }));
  server.registerTool("get_asset", { description: "Look up an image asset, including base64-encoded bytes", inputSchema: z.object({ id: uuid }) },
    async ({ id }) => { const row = await assets.get(id); return row ? success({ asset: { ...metadata(row), base64: row.bytes.toString("base64") } }) : failure("Image not found"); });
  server.registerTool("add_asset", { description: "Upload a PNG, JPEG, GIF or WebP (up to 5 MB) encoded as base64", inputSchema: z.object({ name: z.string(), kind: z.enum(["branding", "image", "qr"]), mimeType: z.enum(["image/png", "image/jpeg", "image/gif", "image/webp"]), base64: z.string() }) },
    async ({ name, kind, mimeType, base64 }) => safe(async () => {
      if (base64.length > Math.ceil(assetLimit / 3) * 4 + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new ToolError("Invalid or oversized base64 image");
      return { asset: await assets.add(name, kind, mimeType, Buffer.from(base64, "base64")) };
    }));
  server.registerTool("remove_asset", { description: "Remove an image asset without changing any bulletin references", inputSchema: z.object({ id: uuid }) },
    async ({ id }) => { const removed = await assets.remove(id); return removed ? success({ id: removed.id }) : failure("Image not found"); });
}

/** Bulletin operations use the same persistence and validation service as HTTP drafts. */
export function registerBulletinTools(server: McpServer, db: Database) {
  const drafts = draftStore(db);
  const run = async (operation: () => Promise<Record<string, unknown>>) => {
    try { return success(await operation()); }
    catch (error) { if (error instanceof DraftError) return draftFailure(error); throw error; }
  };
  server.registerTool("list_bulletins", { description: "List bulletins by gathering date, optionally filtering to one date", inputSchema: z.object({ date: z.string().optional() }) },
    async ({ date }) => run(async () => ({ bulletins: await drafts.list(date) })));
  server.registerTool("get_bulletin", { description: "Find a bulletin by its ID, including its complete ordered cover and reading-order blocks", inputSchema: z.object({ id: z.string() }) },
    async ({ id }) => run(async () => { const bulletin = await drafts.get(id); if (!bulletin) throw new DraftError(404, "Bulletin not found"); return { bulletin }; }));
  server.registerTool("create_bulletin", { description: "Create a dated bulletin with the editable starter composition; only one bulletin per gathering date", inputSchema: z.object({ gatheringDate: z.string() }) },
    async ({ gatheringDate }) => run(async () => ({ bulletin: await drafts.create(gatheringDate) })));
  server.registerTool("save_bulletin", { description: "Replace the full ordered cover and reading-order composition and optionally change its date. Supply the expected revision; on conflict the latest persisted bulletin is returned without changing it.", inputSchema: z.object({ id: z.string(), gatheringDate: z.string(), revision: z.number(), composition: z.unknown() }) },
    async ({ id, gatheringDate, revision, composition }) => run(async () => ({ bulletin: await drafts.save(id, { gatheringDate, revision, composition }) })));
  server.registerTool("delete_bulletin", { description: "Delete a bulletin by ID", inputSchema: z.object({ id: z.string() }) },
    async ({ id }) => run(async () => ({ deleted: await drafts.remove(id) })));
  server.registerTool("get_bulletin_pdf", { description: "Generate the complete PDF from the persisted bulletin and live song/asset libraries; returns base64 bytes, MIME type, filename and gathering date, or a located generation error", inputSchema: z.object({ id: z.string() }) },
    async ({ id }) => {
      try {
        const rendered = await renderPersistedBulletinPdf(db, id);
        if (!rendered) throw new DraftError(404, "Bulletin not found");
        return success({ mimeType: "application/pdf", filename: `ruf-bulletin-${rendered.date}.pdf`, gatheringDate: rendered.date, base64: rendered.bytes.toString("base64") });
      } catch (error) {
        if (error instanceof DraftError) return draftFailure(error);
        if (error instanceof PdfError || error instanceof PdfGenerationError) {
          return { ...success({ error: error.message, ...(error instanceof PdfError ? { block: error.block } : {}) }), isError: true };
        }
        throw error;
      }
    });
}

export function createMcpEndpoint(db: Database) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: "ruf-bulletin-studio", version: "0.1.0" });
    registerLibraryTools(server, db);
    registerBulletinTools(server, db);
    return server;
  }, { maxRequestBodySize: 8 * 1024 * 1024 });
}
