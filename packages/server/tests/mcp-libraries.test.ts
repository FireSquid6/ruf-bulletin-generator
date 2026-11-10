import { describe, expect, test } from "bun:test";
import { createHash, randomBytes } from "node:crypto";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";
import { createMcpEndpoint } from "../src/mcp";
import type { Database } from "../src/db";
import { bulletin, imageAsset, mcpKey, song, user } from "../src/schema";

const url = process.env.TEST_DATABASE_URL;
const origin = "http://localhost";

test("official MCP client negotiates streamable HTTP and discovers library tools", async () => {
  const endpoint = createMcpEndpoint({} as Database);
  const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
    fetch: (input, init) => endpoint.fetch(new Request(input, init)),
  });
  const client = new Client({ name: "discovery-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("save_song");
  } finally { await client.close(); }
});

describe.skipIf(!url)("MCP libraries via official HTTP client (Postgres)", () => {
  test("song catalog edits and image assets preserve live draft references; revoked keys lose access", async () => {
    const database = createDatabase(url!);
    const app = createApp(database.db, { secret: "test-secret-at-least-thirty-two-characters", baseURL: origin });
    const account = crypto.randomUUID();
    const keyId = crypto.randomUUID();
    const token = `ruf_mcp_${randomBytes(32).toString("base64url")}`;
    const songKey = `mcp-${crypto.randomUUID()}`;
    const renamed = `${songKey}-new`;
    const draftId = crypto.randomUUID();
    let assetId: string | undefined;
    const client = (authorization: string) => {
      const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
        requestInit: { headers: { authorization } },
        fetch: (input, init) => app.handle(new Request(input, init)),
      });
      const connection = new Client({ name: "library-test", version: "1.0.0" });
      return { connection, transport };
    };
    const call = async (connection: Client, name: string, args: Record<string, unknown>) => {
      const result = await connection.callTool({ name, arguments: args });
      return { ...result, data: result.structuredContent as Record<string, any> };
    };
    let active: ReturnType<typeof client> | undefined;
    try {
      await database.db.insert(user).values({ id: account, name: "MCP staff", email: `${account}@example.org` });
      await database.db.insert(mcpKey).values({ id: keyId, userId: account, label: "Library", secretHash: createHash("sha256").update(token).digest("hex") });
      const invalid = client("Bearer invalid");
      await expect(invalid.connection.connect(invalid.transport)).rejects.toThrow();
      active = client(`Bearer ${token}`);
      await active.connection.connect(active.transport);
      const tools = (await active.connection.listTools()).tools.map((tool) => tool.name);
      expect(tools).toEqual(expect.arrayContaining(["find_songs", "get_song", "save_song", "delete_song", "list_assets", "get_asset", "add_asset", "remove_asset"]));
      expect(tools.some((name) => /account|invitation|key|staff/.test(name))).toBe(false);
      const initial = { key: songKey, title: "A Hymn", parts: [{ label: "Verse 1", text: "First" }, { label: "Chorus", style: "chorus", text: "Refrain" }], columns: 2, scale: 0.9 };
      expect((await call(active.connection, "save_song", initial)).data.song).toEqual(initial);
      expect((await call(active.connection, "find_songs", { search: "a hymn" })).data.songs).toEqual([initial]);
      expect((await call(active.connection, "get_song", { key: songKey })).data.song).toEqual(initial);
      expect((await call(active.connection, "save_song", initial)).isError).toBe(true);
      await database.db.insert(bulletin).values({ id: draftId, gatheringDate: "2099-02-17", composition: JSON.stringify({ cover: [], flow: [{ type: "song", songKey }] }) });
      const updated = { key: renamed, title: "A New Hymn", parts: [initial.parts[1], initial.parts[0]], columns: null, scale: null };
      expect((await call(active.connection, "save_song", { previousKey: songKey, ...updated })).data.song).toEqual(updated);
      expect((await call(active.connection, "get_song", { key: songKey })).isError).toBe(true);
      expect((await call(active.connection, "get_song", { key: renamed })).data.song.parts).toEqual(updated.parts);
      expect((await call(active.connection, "delete_song", { key: renamed })).data.deleted).toBe(renamed);
      expect((await call(active.connection, "save_song", initial)).data.song.key).toBe(songKey);

      const png = Buffer.from(await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer());
      const added = await call(active.connection, "add_asset", { name: "New mark", kind: "branding", mimeType: "image/png", base64: png.toString("base64") });
      expect(added.isError).not.toBe(true);
      assetId = added.data.asset.id;
      const composition = JSON.stringify({ cover: [], flow: [{ type: "song", songKey }, { type: "branding", assetId }] });
      await database.db.update(bulletin).set({ composition }).where(eq(bulletin.id, draftId));
      expect((await call(active.connection, "list_assets", {})).data.assets).toEqual(expect.arrayContaining([expect.objectContaining({ id: assetId, name: "New mark" })]));
      expect((await call(active.connection, "get_asset", { id: assetId })).data.asset).toMatchObject({ id: assetId, mimeType: "image/png", base64: png.toString("base64") });
      expect((await call(active.connection, "add_asset", { name: "Bad", kind: "qr", mimeType: "image/png", base64: Buffer.from("not a PNG").toString("base64") })).isError).toBe(true);
      expect((await call(active.connection, "remove_asset", { id: assetId })).data.id).toBe(assetId);
      expect((await call(active.connection, "get_asset", { id: assetId })).isError).toBe(true);
      expect((await database.db.select().from(bulletin).where(eq(bulletin.id, draftId)))[0]?.composition).toBe(composition);

      await database.db.update(mcpKey).set({ revokedAt: new Date() }).where(eq(mcpKey.id, keyId));
      await expect(active.connection.listTools()).rejects.toThrow();
      await expect(active.connection.callTool({ name: "find_songs", arguments: {} })).rejects.toThrow();
      const revoked = client(`Bearer ${token}`);
      await expect(revoked.connection.connect(revoked.transport)).rejects.toThrow();
    } finally {
      await active?.connection.close();
      await database.db.delete(bulletin).where(eq(bulletin.id, draftId));
      await database.db.delete(song).where(eq(song.key, songKey));
      await database.db.delete(song).where(eq(song.key, renamed));
      if (assetId) await database.db.delete(imageAsset).where(eq(imageAsset.id, assetId));
      await database.db.delete(user).where(eq(user.id, account));
      await database.close();
    }
  });
});
