import { describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { Client } from "pg";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("dated drafts at the authenticated HTTP boundary (Postgres)", () => {
  test("create, find, revise, reject duplicate dates and stale saves, then delete", async () => {
    const schema = `draft_test_${crypto.randomUUID().replaceAll("-", "")}`;
    const setup = new Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts", "0004_assets"]) {
      await setup.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
    }
    const logoBytes = Buffer.from(await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer());
    const logoId = "00000000-0000-4000-8000-000000000004";
    await setup.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)",
      [logoId, "RUF Baylor logo", "branding", "image/png", logoBytes.length, logoBytes]);
    const testUrl = new URL(url!);
    testUrl.searchParams.set("options", `-csearch_path=${schema}`);
    const database = createDatabase(testUrl.toString());
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const app = createApp(database.db, config);
    const date = "2033-04-07", next = "2033-04-14";
    let cookie = "";
    const call = (path: string, method = "GET", body?: unknown) => app.handle(new Request(`http://localhost${path}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    try {
      expect((await call("/api/bulletins", "POST", { gatheringDate: date })).status).toBe(401);
      const email = `draft-${crypto.randomUUID()}@example.org`;
      await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Staff", password: "valid-password-123" } });
      const login = await call("/api/auth/sign-in/email", "POST", { email, password: "valid-password-123" });
      cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect((await call("/api/bulletins", "POST", { gatheringDate: "2033-02-29" })).status).toBe(400);
      const created = await call("/api/bulletins", "POST", { gatheringDate: date });
      expect(created.status).toBe(201);
      const draft = await created.json();
      expect(draft.gatheringDate).toBe(date);
      expect(draft.revision).toBe(1);
      expect(draft.composition.cover.some((block: { type: string; assetId: string }) => block.type === "branding" && block.assetId === logoId)).toBe(true);
      const logo = await call(`/api/assets/${draft.composition.cover[0].assetId}/image`);
      expect(logo.status).toBe(200);
      expect(Buffer.from(await logo.arrayBuffer())).toEqual(logoBytes);
      expect(JSON.stringify(draft.composition)).not.toContain("James 5");
      expect((await call("/api/bulletins", "POST", { gatheringDate: date })).status).toBe(409);
      expect((await call(`/api/bulletins?date=${date}`)).json()).resolves.toMatchObject({ bulletins: [{ id: draft.id, gatheringDate: date }] });
      expect((await call(`/api/bulletins/${draft.id}`)).json()).resolves.toEqual(draft);
      const restartedApp = createApp(database.db, config);
      expect((await restartedApp.handle(new Request(`http://localhost/api/bulletins/${draft.id}`, { headers: { cookie } }))).json()).resolves.toEqual(draft);

      const second = await (await call("/api/bulletins", "POST", { gatheringDate: next })).json();
      const collision = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: next, revision: 1, composition: { cover: [], flow: [] } });
      expect(collision.status).toBe(409);
      const changed = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: date, revision: 1, composition: { cover: [], flow: [] } });
      expect(changed.status).toBe(200);
      expect(await changed.json()).toMatchObject({ revision: 2, composition: { cover: [], flow: [] } });
      expect((await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: date, revision: 1, composition: { cover: [], flow: [] } })).status).toBe(409);
      expect((await call(`/api/bulletins/${second.id}`, "DELETE")).status).toBe(204);
      const moved = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: next, revision: 2, composition: { cover: [], flow: [] } });
      expect(moved.status).toBe(200);
      expect((await call(`/api/bulletins?date=${next}`)).json()).resolves.toMatchObject({ bulletins: [{ id: draft.id }] });
      expect((await call(`/api/bulletins/${draft.id}`, "DELETE")).status).toBe(204);
      expect((await call(`/api/bulletins/${draft.id}`)).status).toBe(404);
    } finally {
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});
