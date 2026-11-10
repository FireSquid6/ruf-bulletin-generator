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
    const logoId = "00000000-0000-4000-8000-000000000004";
    expect((await setup.query("SELECT name FROM schema_migration WHERE name = '0002_drafts'")).rowCount).toBe(1);
    expect((await setup.query("SELECT id FROM image_asset WHERE id = $1", [logoId])).rowCount).toBe(1);
    await setup.query(`CREATE SCHEMA ${schema}`);
    await setup.query(`SET search_path TO ${schema}`);
    for (const name of ["0001_workspace", "0002_drafts", "0004_assets"]) {
      await setup.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
    }
    const logoBytes = Buffer.from(await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer());
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
      // Both editors start from the same saved revision. Only one write may win,
      // and the losing editor must receive the actual saved content to review.
      const competing = await Promise.all([
        call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2033-04-21", revision: 3, composition: { cover: [{ type: "text", text: "Editor A" }], flow: [] } }),
        call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: "2033-04-28", revision: 3, composition: { cover: [], flow: [{ type: "text", text: "Editor B" }] } }),
      ]);
      expect(competing.map((response) => response.status).sort()).toEqual([200, 409]);
      const winner = await competing.find((response) => response.status === 200)!.json();
      const loser = await competing.find((response) => response.status === 409)!.json();
      expect(loser).toEqual({ error: "This bulletin has a newer revision.", latest: winner });
      expect((await call(`/api/bulletins/${draft.id}`)).json()).resolves.toEqual(winner);
      // A third save after the conflict cannot be silently overwritten with
      // the revision shown in the first comparison.
      const third = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: winner.gatheringDate, revision: winner.revision, composition: { cover: [], flow: [{ type: "text", text: "Third editor" }] } });
      expect(third.status).toBe(200);
      const thirdDraft = await third.json();
      const staleOverwrite = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: next, revision: winner.revision, composition: { cover: [], flow: [{ type: "text", text: "Recovered work" }] } });
      expect(staleOverwrite.status).toBe(409);
      expect(await staleOverwrite.json()).toEqual({ error: "This bulletin has a newer revision.", latest: thirdDraft });
      const recovered = await call(`/api/bulletins/${draft.id}`, "PUT", { gatheringDate: next, revision: thirdDraft.revision, composition: { cover: [], flow: [{ type: "text", text: "Recovered work" }] } });
      expect(recovered.status).toBe(200);
      expect(await recovered.json()).toMatchObject({ revision: 6, gatheringDate: next, composition: { flow: [{ type: "text", text: "Recovered work" }] } });
      expect((await call(`/api/bulletins/${draft.id}`, "DELETE")).status).toBe(204);
      expect((await call(`/api/bulletins/${draft.id}`)).status).toBe(404);
    } finally {
      await database.close();
      await setup.query(`DROP SCHEMA ${schema} CASCADE`);
      await setup.end();
    }
  });
});
