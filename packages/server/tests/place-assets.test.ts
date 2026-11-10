import { describe, expect, test } from "bun:test";
import { Client } from "pg";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("placed image references over authenticated HTTP (Postgres)", () => {
  test("uploaded branding, images and ordered QR items survive reload and deletion keeps unavailable references", async () => {
    const schema = `placed_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts", "0004_assets"]) {
      await setup.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
    }
    const testUrl = new URL(url!);
    testUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const database = createDatabase(testUrl.toString());
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const app = createApp(database.db, config);
    const png = await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer();
    let cookie = "";
    const call = (path: string, init: RequestInit = {}, target = app) => target.handle(new Request(`http://localhost${path}`, {
      ...init, headers: { ...(cookie ? { cookie } : {}), origin: "http://localhost", ...init.headers },
    }));
    try {
      const email = `place-${crypto.randomUUID()}@example.org`;
      await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Staff", password: "valid-password-123" } });
      const login = await call("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: "valid-password-123" }) });
      expect(login.status).toBe(200);
      cookie = login.headers.get("set-cookie")!.split(";")[0];
      const upload = async (kind: string) => {
        const form = new FormData();
        form.set("name", `${kind} asset`);
        form.set("kind", kind);
        form.set("file", new File([png], "logo.png", { type: "image/png" }));
        const response = await call("/api/assets", { method: "POST", body: form });
        expect(response.status).toBe(201);
        return (await response.json() as { id: string }).id;
      };
      const brand = await upload("branding"), image = await upload("image"), qr = await upload("qr");
      const created = await (await call("/api/bulletins", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ gatheringDate: "2034-05-21" }) })).json();
      const composition = { cover: [{ type: "image", assetId: image }], flow: [
        { type: "qr", items: [{ assetId: qr, caption: "Join", size_mm: 21 }, { assetId: qr, caption: "Return", size_mm: 28 }] },
        { type: "branding", assetId: brand },
      ] };
      const saved = await call(`/api/bulletins/${created.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ gatheringDate: "2034-05-21", revision: 1, composition }) });
      expect(saved.status).toBe(200);
      const reloaded = createApp(database.db, config);
      expect((await (await call(`/api/bulletins/${created.id}`, {}, reloaded)).json()).composition).toEqual(composition);
      expect((await call(`/api/assets/${qr}`, { method: "DELETE" })).status).toBe(200);
      expect((await call(`/api/assets/${brand}`, { method: "DELETE" })).status).toBe(200);
      expect((await call(`/api/assets/${qr}/image`, {}, reloaded)).status).toBe(404);
      expect((await call(`/api/assets/${brand}/image`, {}, reloaded)).status).toBe(404);
      const afterDeletion = await (await call(`/api/bulletins/${created.id}`, {}, reloaded)).json();
      expect(afterDeletion.composition).toEqual(composition);
      const repaired = { cover: composition.cover, flow: [{ ...composition.flow[0], items: [{ assetId: image, caption: "Join", size_mm: 21 }, { assetId: qr, caption: "Return", size_mm: 28 }] }, { type: "branding", assetId: image }] };
      const revision = await call(`/api/bulletins/${created.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ gatheringDate: "2034-05-21", revision: afterDeletion.revision, composition: repaired }) });
      expect(revision.status).toBe(200);
      expect((await (await call(`/api/bulletins/${created.id}`, {}, reloaded)).json()).composition).toEqual(repaired);
    } finally {
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});
