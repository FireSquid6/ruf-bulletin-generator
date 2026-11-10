import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { inflateSync } from "node:zlib";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("dated PDF at the authenticated HTTP boundary", () => {
  test("preview and download render the saved composition, including zero passages, with dated metadata and explicit failures", async () => {
    const schema = `pdf_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts"]) {
      await setup.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
    }
    const testUrl = new URL(url!);
    testUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const database = createDatabase(testUrl.toString());
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const app = createApp(database.db, config);
    let cookie = "";
    const call = (path: string, method = "GET", body?: unknown) => app.handle(new Request(`http://localhost${path}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    try {
      expect((await call("/api/bulletins/nonexistent/pdf")).status).toBe(401);
      const email = `pdf-${crypto.randomUUID()}@example.org`;
      await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Staff", password: "valid-password-123" } });
      cookie = (await call("/api/auth/sign-in/email", "POST", { email, password: "valid-password-123" })).headers.get("set-cookie")!.split(";")[0];
      expect((await call("/api/bulletins/nonexistent/pdf")).status).toBe(404);
      const draft = await (await call("/api/bulletins", "POST", { gatheringDate: "2034-05-21" })).json();
      const composition = { cover: [{ type: "heading", title: "Gathering" }, { type: "text", text: "Welcome to the gathering" }], flow: [{ type: "scripture", role: "reading", reference: "Psalm 1", text: "A reading" }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 1, composition })).status).toBe(200);
      const preview = await call(`/api/bulletins/${draft.id}/pdf`);
      const download = await call(`/api/bulletins/${draft.id}/pdf?download=1`);
      expect(preview.status).toBe(200);
      expect(preview.headers.get("content-type")).toContain("application/pdf");
      expect(preview.headers.get("content-disposition")).toContain("inline");
      expect(download.headers.get("content-disposition")).toContain('attachment; filename="ruf-bulletin-2034-05-21.pdf"');
      const bytes = Buffer.from(await preview.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.toString("latin1").match(/\/Type \/Page[^s]/g)?.length).toBe(2);
      expect(bytes.toString("latin1")).toContain("D:20340521000000Z");
      expect(bytes.toString("latin1")).toContain("/Title ");
      expect(bytes.includes(Buffer.from([0, 82, 0, 85, 0, 70]))).toBe(true);
      const pageText = [...bytes.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .map((match) => inflateSync(Buffer.from(match[1], "latin1")).toString()).join("\n");
      expect(pageText).toContain(Buffer.from("May 21, 2034").toString("hex"));
      expect(pageText).toContain(Buffer.from("A reading").toString("hex"));
      expect(bytes).toEqual(Buffer.from(await download.arrayBuffer()));
      expect((await call(`/api/bulletins/${draft.id}/pdf?download=0`)).status).toBe(200);
      const empty = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 2, composition: { cover: [], flow: [] } });
      expect(empty.status).toBe(200);
      expect((await call(`/api/bulletins/${draft.id}/pdf`)).status).toBe(200);
      const overflow = { cover: [], flow: [{ type: "text", text: "Overflow ".repeat(30000) }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 3, composition: overflow })).status).toBe(200);
      const failed = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(failed.status).toBe(422);
      expect(await failed.json()).toMatchObject({ block: { area: "flow", index: 0, type: "text" } });
      expect((await call(`/api/bulletins/${draft.id}`)).status).toBe(200);
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 4, composition: { cover: [], flow: [{ type: "song", songKey: "not-yet" }] } })).status).toBe(200);
      expect(await (await call(`/api/bulletins/${draft.id}/pdf`)).json()).toMatchObject({ block: { area: "flow", index: 0, type: "song" } });
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 5, composition: { cover: [{ type: "image", assetId: "later" }], flow: [] } })).status).toBe(200);
      const unsupported = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(unsupported.status).toBe(422);
      expect(await unsupported.json()).toMatchObject({ block: { area: "cover", index: 0, type: "image" } });
      const grouped = { cover: [{ type: "announcements", title: "News", items: [{ title: "Campus", text: "Tuesday gathering" }, { text: "Friday dinner" }] }], flow: [] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 6, composition: grouped })).status).toBe(200);
      const groupedPdf = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(groupedPdf.status).toBe(200);
      const groupedText = [...Buffer.from(await groupedPdf.arrayBuffer()).toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .map((match) => inflateSync(Buffer.from(match[1], "latin1")).toString())
        .flatMap((stream) => [...stream.matchAll(/<([0-9a-f]+)>/gi)].map((match) => match[1]))
        .map((hex) => Buffer.from(hex, "hex").toString("latin1")).join("");
      expect(groupedText).toContain("Campus Tuesday gathering");
      expect(groupedText).toContain("Friday dinner");
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 7, composition: { cover: [], flow: [{ type: "qr", items: [{ caption: "Join", assetId: "later", size_mm: 22 }] }] } })).status).toBe(200);
      const qr = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(qr.status).toBe(422);
      expect(await qr.json()).toMatchObject({ error: expect.stringContaining("QR"), block: { area: "flow", index: 0, type: "qr" } });
      expect((await (await call(`/api/bulletins/${draft.id}`)).json()).composition.flow).toEqual([{ type: "qr", items: [{ caption: "Join", assetId: "later", size_mm: 22 }] }]);
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 8, composition: { cover: [{ type: "text", text: "Too much ".repeat(20000) }], flow: [] } })).status).toBe(200);
      const coverOverflow = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(coverOverflow.status).toBe(422);
      expect(await coverOverflow.json()).toMatchObject({ block: { area: "cover", index: 0, type: "text" } });
    } finally {
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});
