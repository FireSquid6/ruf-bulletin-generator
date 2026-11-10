import { Elysia } from "elysia";
import { eq, desc } from "drizzle-orm";
import sharp from "sharp";
import type { Database } from "./db";
import type { createAuth } from "./auth";
import { imageAsset } from "./schema";

export const assetLimit = 5 * 1024 * 1024;
const limit = assetLimit;
const kinds = new Set(["branding", "image", "qr"]);

const imageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export const metadata = (row: Pick<typeof imageAsset.$inferSelect, "id" | "name" | "kind" | "mimeType" | "size" | "createdAt">) => ({ id: row.id, name: row.name, kind: row.kind, mimeType: row.mimeType, size: row.size, createdAt: row.createdAt.toISOString() });
const columns = { id: imageAsset.id, name: imageAsset.name, kind: imageAsset.kind, mimeType: imageAsset.mimeType, size: imageAsset.size, createdAt: imageAsset.createdAt };

export class AssetError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export async function validateAsset(name: string, kind: string, mimeType: string, bytes: Buffer) {
  if (!name.trim() || name.trim().length > 160 || !kinds.has(kind)) throw new AssetError("Enter a name (up to 160 characters) and choose branding, image, or QR.", 400);
  if (!bytes.length) throw new AssetError("Choose an image to upload.", 400);
  if (bytes.length > limit) throw new AssetError("Image is too large. Choose a file under 5 MB.", 413);
  const invalidFormat = () => new AssetError("Choose a PNG, JPEG, GIF, or WebP image. The file must match its format.", 415);
  if (!imageTypes.has(mimeType)) throw invalidFormat();
  try {
    // Reuse the PDF image decoder for header detection, not the client MIME claim.
    // metadata() does not fully decode pixels; PDF generation still checks that.
    const detected = await sharp(bytes, { animated: false, limitInputPixels: 20_000_000 }).metadata();
    if (detected.mediaType !== mimeType) throw invalidFormat();
  } catch {
    throw invalidFormat();
  }
  return { name: name.trim(), kind, mimeType, bytes, size: bytes.length };
}

export const assetStore = (db: Database) => ({
  list: async () => (await db.select(columns).from(imageAsset).orderBy(desc(imageAsset.createdAt), imageAsset.name)).map(metadata),
  get: async (id: string) => (await db.select().from(imageAsset).where(eq(imageAsset.id, id)))[0],
  add: async (name: string, kind: string, mimeType: string, bytes: Buffer) => {
    const input = await validateAsset(name, kind, mimeType, bytes);
    const [row] = await db.insert(imageAsset).values({ id: crypto.randomUUID(), ...input }).returning();
    return metadata(row);
  },
  rename: async (id: string, name: string) => {
    const [row] = await db.update(imageAsset).set({ name: name.trim() }).where(eq(imageAsset.id, id)).returning();
    return row && metadata(row);
  },
  remove: async (id: string) => (await db.delete(imageAsset).where(eq(imageAsset.id, id)).returning({ id: imageAsset.id }))[0],
});

async function boundedForm(request: Request): Promise<FormData | "large" | "invalid"> {
  if (!request.body) return "invalid";
  const reader = request.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit + 65536) { await reader.cancel(); return "large"; }
      parts.push(value);
    }
    const body = new ArrayBuffer(size);
    let offset = 0;
    for (const part of parts) { new Uint8Array(body).set(part, offset); offset += part.length; }
    return await new Request(request.url, { method: "POST", headers: { "content-type": request.headers.get("content-type") ?? "" }, body }).formData();
  } catch { return "invalid"; } finally { reader.releaseLock(); }
}

export function assetRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  const authorized = (headers: Headers) => auth.api.getSession({ headers });
  const store = assetStore(db);
  return new Elysia()
    .get("/api/assets", async ({ request, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      return { assets: await store.list() };
    })
    .post("/api/assets", async ({ request, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      if (Number(request.headers.get("content-length")) > limit + 65536) { set.status = 413; return { error: "Image is too large. Choose a file under 5 MB." }; }
      const form = await boundedForm(request);
      if (form === "large") { set.status = 413; return { error: "Image is too large. Choose a file under 5 MB." }; }
      if (form === "invalid") { set.status = 400; return { error: "Upload a valid image form." }; }
      const file = form.get("file");
      const name = form.get("name");
      const kind = form.get("kind");
      if (typeof name !== "string" || !name.trim() || name.trim().length > 160 || typeof kind !== "string" || !kinds.has(kind)) {
        set.status = 400; return { error: "Enter a name (up to 160 characters) and choose branding, image, or QR." };
      }
      if (!(file instanceof File) || file.size === 0 || file.size > limit) {
        set.status = file instanceof File && file.size > limit ? 413 : 400;
        return { error: file instanceof File && file.size > limit ? "Image is too large. Choose a file under 5 MB." : "Choose an image to upload." };
      }
      const bytes = Buffer.from(await file.arrayBuffer());
      let asset;
      try { asset = await store.add(name, kind, file.type, bytes); }
      catch (error) {
        if (!(error instanceof AssetError)) throw error;
        set.status = error.status;
        return { error: error.message };
      }
      set.status = 201;
      return asset;
    })
    .get("/api/assets/:id/image", async ({ request, params, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) { set.status = 404; return { error: "Image not found" }; }
      const row = await store.get(params.id);
      if (!row) { set.status = 404; return { error: "Image not found" }; }
      return new Response(new Uint8Array(row.bytes), { headers: { "Content-Type": row.mimeType, "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    })
    .patch("/api/assets/:id", async ({ request, params, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      let input: unknown;
      try { input = await request.json(); } catch { set.status = 400; return { error: "Enter a valid image name." }; }
      const name = typeof input === "object" && input !== null && "name" in input ? input.name : null;
      if (typeof name !== "string" || !name.trim() || name.trim().length > 160) { set.status = 400; return { error: "Enter an image name (up to 160 characters)." }; }
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) { set.status = 404; return { error: "Image not found" }; }
      const row = await store.rename(params.id, name);
      if (!row) { set.status = 404; return { error: "Image not found" }; }
      return row;
    })
    .delete("/api/assets/:id", async ({ request, params, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) { set.status = 404; return { error: "Image not found" }; }
      const row = await store.remove(params.id);
      if (!row) { set.status = 404; return { error: "Image not found" }; }
      return { id: row.id };
    });
}
