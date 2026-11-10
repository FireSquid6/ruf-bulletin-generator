import { Elysia } from "elysia";
import { eq, desc } from "drizzle-orm";
import type { Database } from "./db";
import type { createAuth } from "./auth";
import { imageAsset } from "./schema";

const limit = 5 * 1024 * 1024;
const kinds = new Set(["branding", "image", "qr"]);

function detectedType(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(Buffer.from(bytes.subarray(0, 6)).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
}

const metadata = (row: Pick<typeof imageAsset.$inferSelect, "id" | "name" | "kind" | "mimeType" | "size" | "createdAt">) => ({ id: row.id, name: row.name, kind: row.kind, mimeType: row.mimeType, size: row.size, createdAt: row.createdAt.toISOString() });
const columns = { id: imageAsset.id, name: imageAsset.name, kind: imageAsset.kind, mimeType: imageAsset.mimeType, size: imageAsset.size, createdAt: imageAsset.createdAt };

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
  return new Elysia()
    .get("/api/assets", async ({ request, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      return { assets: (await db.select(columns).from(imageAsset).orderBy(desc(imageAsset.createdAt), imageAsset.name)).map(metadata) };
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
      const mimeType = detectedType(bytes);
      if (!mimeType || file.type !== mimeType) { set.status = 415; return { error: "Choose a PNG, JPEG, GIF, or WebP image. The file must match its format." }; }
      const [row] = await db.insert(imageAsset).values({ id: crypto.randomUUID(), name: name.trim(), kind, mimeType, size: bytes.length, bytes }).returning();
      set.status = 201;
      return metadata(row);
    })
    .get("/api/assets/:id/image", async ({ request, params, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) { set.status = 404; return { error: "Image not found" }; }
      const [row] = await db.select().from(imageAsset).where(eq(imageAsset.id, params.id));
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
      const [row] = await db.update(imageAsset).set({ name: name.trim() }).where(eq(imageAsset.id, params.id)).returning();
      if (!row) { set.status = 404; return { error: "Image not found" }; }
      return metadata(row);
    })
    .delete("/api/assets/:id", async ({ request, params, set }) => {
      if (!await authorized(request.headers)) { set.status = 401; return { error: "Sign in required" }; }
      if (!/^[0-9a-f-]{36}$/i.test(params.id)) { set.status = 404; return { error: "Image not found" }; }
      const [row] = await db.delete(imageAsset).where(eq(imageAsset.id, params.id)).returning({ id: imageAsset.id });
      if (!row) { set.status = 404; return { error: "Image not found" }; }
      return { id: row.id };
    });
}
