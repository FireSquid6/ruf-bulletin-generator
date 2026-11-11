import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { inflateSync } from "node:zlib";
import sharp from "sharp";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { renderPersistedBulletinPdf } from "../src/pdf";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("dated PDF at the authenticated HTTP boundary", () => {
  test("preview and download render the saved composition, including zero passages, with dated metadata and explicit failures", async () => {
    const schema = `pdf_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts", "0003_songs", "0004_assets"]) {
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
      expect(await qr.json()).toMatchObject({ error: expect.stringContaining("unavailable"), block: { area: "flow", index: 0, type: "qr", itemIndex: 0 } });
      expect((await (await call(`/api/bulletins/${draft.id}`)).json()).composition.flow).toEqual([{ type: "qr", items: [{ caption: "Join", assetId: "later", size_mm: 22 }] }]);
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 8, composition: { cover: [{ type: "text", text: "Too much ".repeat(20000) }], flow: [] } })).status).toBe(200);
      const coverOverflow = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(coverOverflow.status).toBe(422);
      expect(await coverOverflow.json()).toMatchObject({ block: { area: "cover", index: 0, type: "text" } });
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 9, composition: { cover: [], flow: [{ type: "contacts", items: [{ name: "Pat", detail: "pat@example.org" }] }] } })).status).toBe(200);
      const contacts = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(contacts.status).toBe(200);
      expect(pdfText(Buffer.from(await contacts.arrayBuffer()))).toContain("pat@example.org");
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-05-21", revision: 10, composition: { cover: [{ type: "spacer" }], flow: [] } })).status).toBe(200);
      const spacer = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(spacer.status).toBe(200);
    } finally {
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});

function pdfText(bytes: Buffer) {
  return [...bytes.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
    .flatMap((match) => {
      try { return [...inflateSync(Buffer.from(match[1], "latin1")).toString().matchAll(/<([0-9a-f]+)>/gi)].map((part) => Buffer.from(part[1], "hex").toString("latin1")); }
      catch { return []; }
    }).join("");
}

describe.skipIf(!url)("complete PDF from saved references", () => {
  test("live songs and database images render in old drafts; broken references and fit errors are located without mutating drafts", async () => {
    const schema = `pdf_refs_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts", "0003_songs", "0004_assets"]) {
      await setup.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
    }
    const logo = Buffer.from(await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer());
    await setup.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)",
      ["00000000-0000-4000-8000-000000000004", "Logo", "branding", "image/png", logo.length, logo]);
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
      const email = `pdf-refs-${crypto.randomUUID()}@example.org`;
      await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Staff", password: "valid-password-123" } });
      cookie = (await call("/api/auth/sign-in/email", "POST", { email, password: "valid-password-123" })).headers.get("set-cookie")!.split(";")[0];
      const draft = await (await call("/api/bulletins", "POST", { gatheringDate: "2034-06-11" })).json();
      const key = `hymn-${crypto.randomUUID()}`;
      const logoId = "00000000-0000-4000-8000-000000000004";
      const composition = { cover: [{ type: "branding", assetId: logoId }, { type: "contacts", items: [{ name: "Pat", detail: "pat@example.org" }] }], flow: [{ type: "song", songKey: key }, { type: "image", assetId: logoId }, { type: "qr", items: [{ assetId: logoId, caption: "Join the group", size_mm: 14 }, { assetId: logoId, caption: "Second code", size_mm: 21 }] }, { type: "spacer" }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 1, composition })).status).toBe(200);
      const missingSong = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(missingSong.status).toBe(422);
      expect(await missingSong.json()).toMatchObject({ block: { area: "flow", index: 0, type: "song" } });
      expect((await call("/api/songs", "POST", { key, title: "First Title", parts: [{ label: "Verse 1", text: "First lyric" }, { style: "chorus", text: "Second lyric" }], columns: 2, scale: 0.85 })).status).toBe(201);
      const first = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(first.status).toBe(200);
      const firstBytes = Buffer.from(await first.arrayBuffer());
      expect(pdfText(firstBytes)).toContain("First Title");
      expect(pdfText(firstBytes)).toContain("First lyric");
      expect(pdfText(firstBytes)).toContain("Second lyric");
      expect(pdfText(firstBytes)).toContain("Join the group");
      expect(pdfText(firstBytes)).toContain("Second code");
      expect(pdfText(firstBytes)).toContain("pat@example.org");
      expect(firstBytes.toString("latin1")).toContain("/Subtype /Image");
      const drawing = [...firstBytes.toString("latin1").matchAll(/stream\n([\s\S]*?)\nendstream/g)]
        .flatMap((match) => { try { return [inflateSync(Buffer.from(match[1], "latin1")).toString()]; } catch { return []; } }).join("\n");
      const imageTransforms = drawing.split("\n").filter((line) => line.endsWith(" cm"));
      expect(imageTransforms.some((line) => line.includes("-39.685039 "))).toBe(true); // 14 mm QR in PDF points
      expect(imageTransforms.some((line) => line.includes("-59.527559 "))).toBe(true); // 21 mm QR in PDF points
      expect((await call(`/api/songs/${key}`, "PUT", { key, title: "Current Title", parts: [{ text: "Updated lyric" }], columns: 1, scale: 1 })).status).toBe(200);
      const current = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(current.status).toBe(200);
      const currentBytes = Buffer.from(await current.arrayBuffer());
      const currentText = pdfText(currentBytes);
      expect(currentText).toContain("Current Title");
      expect(currentText).toContain("Updated lyric");
      expect(currentText).not.toContain("First lyric");
      const shared = await renderPersistedBulletinPdf(database.db, draft.id);
      expect(shared?.date).toBe("2034-06-11");
      expect(pdfText(shared!.bytes)).toBe(currentText);
      expect((await (await call(`/api/bulletins/${draft.id}`)).json()).composition).toEqual(composition);
      expect((await call(`/api/songs/${key}`, "PUT", { key: `${key}-renamed`, title: "Renamed", parts: [{ text: "Renamed lyric" }] })).status).toBe(200);
      expect(await (await call(`/api/bulletins/${draft.id}/pdf`)).json()).toMatchObject({ block: { area: "flow", index: 0, type: "song" } });
      await expect(renderPersistedBulletinPdf(database.db, draft.id)).rejects.toMatchObject({ block: { area: "flow", index: 0, type: "song" } });
      expect((await call("/api/songs", "POST", { key, title: "Reconnected", parts: [{ text: "Restored lyric" }] })).status).toBe(201);
      expect(pdfText(Buffer.from(await (await call(`/api/bulletins/${draft.id}/pdf`)).arrayBuffer()))).toContain("Reconnected");
      const missingAssetId = crypto.randomUUID();
      const brokenQr = { cover: [], flow: [{ type: "qr", items: [{ assetId: logoId, caption: "Valid" }, { assetId: missingAssetId, caption: "Missing" }] }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 2, composition: brokenQr })).status).toBe(200);
      const missingQr = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(missingQr.status).toBe(422);
      expect(await missingQr.json()).toMatchObject({ block: { area: "flow", index: 0, type: "qr", itemIndex: 1 } });
      expect((await (await call(`/api/bulletins/${draft.id}`)).json()).composition).toEqual(brokenQr);
      const invalidSize = { cover: [], flow: [{ type: "qr", items: [{ assetId: logoId, size_mm: -1 }] }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 3, composition: invalidSize })).status).toBe(200);
      expect(await (await call(`/api/bulletins/${draft.id}/pdf`)).json()).toMatchObject({ block: { area: "flow", index: 0, type: "qr", itemIndex: 0 } });
      const crowded = { cover: [], flow: [{ type: "qr", items: Array.from({ length: 30 }, () => ({ assetId: logoId })) }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 4, composition: crowded })).status).toBe(200);
      const crowdedPdf = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(crowdedPdf.status).toBe(422);
      expect(await crowdedPdf.json()).toMatchObject({ block: { area: "flow", index: 0, type: "qr" } });
      const overflow = { cover: [], flow: [{ type: "song", songKey: key }, { type: "spacer", height_mm: 500 }] };
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 5, composition: overflow })).status).toBe(200);
      const failed = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(failed.status).toBe(422);
      expect(await failed.json()).toMatchObject({ block: { area: "flow", index: 1, type: "spacer" } });
      const gifId = crypto.randomUUID();
      const gif = await sharp(logo).gif().toBuffer();
      await setup.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)", [gifId, "GIF", "image", "image/gif", gif.length, gif]);
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 6, composition: { cover: [], flow: [{ type: "image", assetId: gifId }] } })).status).toBe(200);
      const convertedGif = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(convertedGif.status).toBe(200);
      expect(Buffer.from(await convertedGif.arrayBuffer()).toString("latin1")).toContain("/Subtype /Image");
      const webpId = crypto.randomUUID();
      const webp = await sharp(logo).webp().toBuffer();
      await setup.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)", [webpId, "WebP", "image", "image/webp", webp.length, webp]);
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 7, composition: { cover: [], flow: [{ type: "image", assetId: webpId }] } })).status).toBe(200);
      expect((await call(`/api/bulletins/${draft.id}/pdf`)).status).toBe(200);
      const damagedId = crypto.randomUUID();
      const damaged = Buffer.from("not a png");
      await setup.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)", [damagedId, "Damaged", "image", "image/png", damaged.length, damaged]);
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 8, composition: { cover: [], flow: [{ type: "image", assetId: damagedId }] } })).status).toBe(200);
      const damagedPdf = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(damagedPdf.status).toBe(422);
      expect(await damagedPdf.json()).toMatchObject({ block: { area: "flow", index: 0, type: "image" } });
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2034-06-11", revision: 9, composition })).status).toBe(200);
      expect((await call(`/api/assets/${logoId}`, "DELETE")).status).toBe(200);
      const removed = await call(`/api/bulletins/${draft.id}/pdf`);
      expect(removed.status).toBe(422);
      expect(await removed.json()).toMatchObject({ block: { area: "cover", index: 0, type: "branding" }, error: expect.stringContaining("unavailable") });
      expect((await (await call(`/api/bulletins/${draft.id}`)).json()).composition).toEqual(composition);
    } finally {
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});
