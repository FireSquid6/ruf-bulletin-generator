import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { Client as PgClient } from "pg";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDatabase } from "../src/db";
import { STARTER_LOGO_ASSET_ID } from "../src/draft-service";

const url = process.env.TEST_DATABASE_URL;
const origin = "http://localhost";

describe.skipIf(!url)("bulletin tools at the authenticated MCP boundary", () => {
  test("create and find dated bulletins with the official client", async () => {
    const schema = `mcp_drafts_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new PgClient({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts", "0003_songs", "0004_assets", "0005_invitations", "0006_keys"]) {
      await setup.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
    }
    const logo = Buffer.from(await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer());
    await setup.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, 'Starter logo', 'branding', 'image/png', $2, $3)", [STARTER_LOGO_ASSET_ID, logo.length, logo]);
    const testUrl = new URL(url!);
    testUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const database = createDatabase(testUrl.toString());
    const app = createApp(database.db, { secret: "test-secret-at-least-thirty-two-characters", baseURL: origin });
    const token = `ruf_mcp_${randomBytes(32).toString("base64url")}`;
    const makeTransport = (authorization: string) => new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      requestInit: { headers: { authorization } }, fetch: (input, init) => app.handle(new Request(input, init)),
    });
    const transport = makeTransport(`Bearer ${token}`);
    const client = new Client({ name: "bulletin-test", version: "1.0.0" });
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      return { error: response.isError === true, data: response.structuredContent as any };
    };
    try {
      const invalid = new Client({ name: "invalid", version: "1.0.0" });
      await expect(invalid.connect(makeTransport("Bearer invalid"))).rejects.toThrow();
      const userId = crypto.randomUUID();
      await setup.query(`INSERT INTO "user" (id, name, email) VALUES ($1, 'MCP staff', $2)`, [userId, `${userId}@example.org`]);
      const keyId = crypto.randomUUID();
      await setup.query(`INSERT INTO mcp_key (id, user_id, label, secret_hash) VALUES ($1, $2, 'Editor', $3)`, [keyId, userId, createHash("sha256").update(token).digest("hex")]);
      await client.connect(transport);
      const tools = (await client.listTools()).tools.map((tool) => tool.name);
      expect(tools).toEqual(expect.arrayContaining(["list_bulletins", "get_bulletin", "create_bulletin", "save_bulletin", "delete_bulletin", "get_bulletin_pdf"]));
      expect(tools).toEqual(expect.arrayContaining(["find_songs", "get_song", "save_song", "delete_song", "list_assets", "get_asset", "add_asset", "remove_asset"]));
      expect(tools.some((name) => /account|invitation|staff|key/.test(name))).toBe(false);
      expect(await call("create_bulletin", { gatheringDate: "2038-02-29" })).toMatchObject({ error: true, data: { status: 400 } });
      const draft = (await call("create_bulletin", { gatheringDate: "2038-05-16" })).data.bulletin;
      expect(draft).toMatchObject({ gatheringDate: "2038-05-16", revision: 1 });
      expect(draft.composition.cover[0].type).toBe("branding");
      expect((await call("list_bulletins", { date: "2038-05-16" })).data).toMatchObject({ bulletins: [{ id: draft.id }] });
      expect(await call("list_bulletins", { date: "2038-02-29" })).toMatchObject({ error: true, data: { status: 400 } });
      expect((await call("get_bulletin", { id: draft.id })).data).toEqual({ bulletin: draft });
      expect(await call("create_bulletin", { gatheringDate: draft.gatheringDate })).toMatchObject({ error: true, data: { status: 409, error: "A bulletin already exists for this date" } });
      const second = (await call("create_bulletin", { gatheringDate: "2038-05-23" })).data.bulletin;
      const composition = {
        cover: [{ type: "heading", title: "Welcome" }, { type: "branding", assetId: STARTER_LOGO_ASSET_ID }, { type: "announcements", items: [{ title: "Second", text: "B" }, { title: "First", text: "A" }] }],
        flow: [{ type: "contacts", items: [{ name: "Two", detail: "2" }, { name: "One", detail: "1" }] }, { type: "scripture", role: "sermon", reference: "Romans 8", text: "A reading" }, { type: "qr", items: [{ assetId: STARTER_LOGO_ASSET_ID, caption: "Join", size_mm: 12 }] }, { type: "song", songKey: "later-song" }, { type: "spacer", height_mm: 2 }, { type: "text", text: "A note" }],
      };
      expect(await call("save_bulletin", { id: draft.id, gatheringDate: second.gatheringDate, revision: 1, composition })).toMatchObject({ error: true, data: { status: 409, error: "A bulletin already exists for this date" } });
      const saved = (await call("save_bulletin", { id: draft.id, gatheringDate: draft.gatheringDate, revision: 1, composition })).data.bulletin;
      expect(saved.composition).toEqual(composition);
      expect(await call("save_bulletin", { id: draft.id, gatheringDate: draft.gatheringDate, revision: 2, composition: { cover: [], flow: [{ type: "song", songKey: "x", title: "Duplicated store data" }] } })).toMatchObject({ error: true, data: { status: 400 } });
      expect((await call("get_bulletin", { id: draft.id })).data.bulletin).toEqual(saved);
      const reordered = { cover: [composition.flow[0], ...composition.cover.slice().reverse()], flow: [...composition.flow.slice(1).reverse(), { type: "announcements", items: [{ title: "First", text: "A" }, { title: "Second", text: "B" }] }] };
      const newer = (await call("save_bulletin", { id: draft.id, gatheringDate: "2038-05-30", revision: 2, composition: reordered })).data.bulletin;
      expect(newer).toMatchObject({ revision: 3, gatheringDate: "2038-05-30", composition: reordered });
      expect(await call("save_bulletin", { id: draft.id, gatheringDate: draft.gatheringDate, revision: 2, composition })).toEqual({ error: true, data: { status: 409, error: "This bulletin has a newer revision.", latest: newer } });
      expect((await call("list_bulletins", { date: "2038-05-30" })).data.bulletins).toMatchObject([{ id: draft.id }]);
      expect((await call("get_bulletin_pdf", { id: draft.id })).data).toMatchObject({ block: { area: "flow", type: "song", index: 2 } });
      expect((await call("get_bulletin_pdf", { id: draft.id })).error).toBe(true);
      expect((await call("save_song", { key: "later-song", title: "Hymn", parts: [{ text: "Lyrics" }] })).error).toBe(false);
      const pdf = await call("get_bulletin_pdf", { id: draft.id });
      expect(pdf.error).toBe(false);
      expect(pdf.data).toMatchObject({ mimeType: "application/pdf", filename: "ruf-bulletin-2038-05-30.pdf", gatheringDate: "2038-05-30" });
      expect(Buffer.from(pdf.data.base64, "base64").subarray(0, 5).toString()).toBe("%PDF-");
      const email = `${crypto.randomUUID()}@example.org`;
      await createAuth(database.db, { secret: "test-secret-at-least-thirty-two-characters", baseURL: origin }).api.signUpEmail({ body: { email, name: "Web editor", password: "valid-password-123" } });
      const login = await app.handle(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "valid-password-123" }) }));
      const webPdf = await app.handle(new Request(`${origin}/api/bulletins/${draft.id}/pdf`, { headers: { cookie: login.headers.get("set-cookie")!.split(";")[0] } }));
      expect(webPdf.status).toBe(200);
      const renderedText = (bytes: Buffer) => [...bytes.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .flatMap((match) => { try { return [inflateSync(Buffer.from(match[1], "latin1")).toString()]; } catch { return []; } }).join("\n");
      expect(renderedText(Buffer.from(pdf.data.base64, "base64"))).toBe(renderedText(Buffer.from(await webPdf.arrayBuffer())));
      expect((await call("delete_song", { key: "later-song" })).error).toBe(false);
      const brokenSong = await call("get_bulletin_pdf", { id: draft.id });
      expect(brokenSong).toMatchObject({ error: true, data: { block: { type: "song" } } });
      const brokenAsset = { cover: [{ type: "image", assetId: crypto.randomUUID() }], flow: [] };
      const changed = (await call("save_bulletin", { id: draft.id, gatheringDate: newer.gatheringDate, revision: 3, composition: brokenAsset })).data.bulletin;
      expect(await call("get_bulletin_pdf", { id: draft.id })).toMatchObject({ error: true, data: { error: expect.stringContaining("unavailable"), block: { area: "cover", index: 0, type: "image" } } });
      expect((await call("get_bulletin", { id: draft.id })).data.bulletin).toEqual(changed);
      const overflowing = (await call("save_bulletin", { id: draft.id, gatheringDate: newer.gatheringDate, revision: 4, composition: { cover: [], flow: [{ type: "text", text: "Too much ".repeat(20000) }] } })).data.bulletin;
      expect(await call("get_bulletin_pdf", { id: draft.id })).toMatchObject({ error: true, data: { block: { area: "flow", index: 0, type: "text" } } });
      expect((await call("get_bulletin", { id: draft.id })).data.bulletin).toEqual(overflowing);
      expect(await call("delete_bulletin", { id: second.id })).toMatchObject({ error: false, data: { deleted: second.id } });
      const moved = (await call("save_bulletin", { id: draft.id, gatheringDate: second.gatheringDate, revision: 5, composition: { cover: [], flow: [] } })).data.bulletin;
      expect(moved.gatheringDate).toBe(second.gatheringDate);
      expect(await call("delete_bulletin", { id: draft.id })).toMatchObject({ error: false, data: { deleted: draft.id } });
      expect(await call("get_bulletin", { id: draft.id })).toMatchObject({ error: true, data: { status: 404 } });
      expect(await call("get_bulletin_pdf", { id: draft.id })).toMatchObject({ error: true, data: { status: 404 } });
      await setup.query("UPDATE mcp_key SET revoked_at = now() WHERE id = $1", [keyId]);
      await expect(client.listTools()).rejects.toThrow();
      await expect(client.callTool({ name: "list_bulletins", arguments: {} })).rejects.toThrow();
      const revoked = new Client({ name: "revoked", version: "1.0.0" });
      await expect(revoked.connect(makeTransport(`Bearer ${token}`))).rejects.toThrow();
    } finally {
      await client.close();
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});
