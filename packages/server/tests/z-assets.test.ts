import { describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { user } from "../src/schema";
import { imageAsset } from "../src/schema";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("image assets over authenticated HTTP (Postgres)", () => {
  test("upload persists bytes across app restart, rename and remove; unauthorized callers cannot access them", async () => {
    const database = createDatabase(url!);
    let reopened: ReturnType<typeof createDatabase> | undefined;
    const email = `asset-${crypto.randomUUID()}@example.org`;
    let id: string | undefined;
    let assetId: string | undefined;
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const png = await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer();
    const call = (app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) => app.handle(new Request(`http://localhost${path}`, init));
    try {
      const created = await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Asset tester", password: "valid-password-123" } });
      id = created.user.id;
      const app = createApp(database.db, config);
      const login = await call(app, "/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ email, password: "valid-password-123" }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect((await call(app, "/api/assets")).status).toBe(401);
      expect((await call(app, "/api/assets", { method: "POST", body: new FormData() })).status).toBe(401);
      const starter = await (await call(app, "/api/assets", { headers: { cookie } })).json() as { assets: { name: string; id: string }[] };
      expect(starter.assets).toEqual(expect.arrayContaining([expect.objectContaining({ name: "RUF Baylor logo" })]));
      const wrong = new FormData();
      wrong.set("name", "Wrong format"); wrong.set("kind", "image");
      wrong.set("file", new File(["<svg></svg>"], "sample.png", { type: "image/png" }));
      expect((await call(app, "/api/assets", { method: "POST", headers: { cookie }, body: wrong })).status).toBe(415);
      const big = new FormData();
      big.set("name", "Too big"); big.set("kind", "image");
      big.set("file", new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }));
      expect((await call(app, "/api/assets", { method: "POST", headers: { cookie }, body: big })).status).toBe(413);
      const form = new FormData();
      form.set("name", "Campus mark");
      form.set("kind", "branding");
      form.set("file", new File([png], "logo.png", { type: "image/png" }));
      const uploaded = await call(app, "/api/assets", { method: "POST", headers: { cookie, origin: "http://localhost" }, body: form });
      expect(uploaded.status).toBe(201);
      const asset = await uploaded.json() as { id: string; name: string };
      assetId = asset.id;
      expect(asset.name).toBe("Campus mark");
      expect((await call(app, `/api/assets/${asset.id}/image`)).status).toBe(401);
      reopened = createDatabase(url!);
      const restarted = createApp(reopened.db, config);
      const image = await call(restarted, `/api/assets/${asset.id}/image`, { headers: { cookie } });
      expect(image.status).toBe(200);
      expect(image.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await image.arrayBuffer())).toEqual(Buffer.from(png));
      expect((await call(restarted, "/api/assets", { headers: { cookie } })).json()).resolves.toMatchObject({ assets: expect.arrayContaining([expect.objectContaining({ id: asset.id })]) });
      expect((await call(restarted, `/api/assets/${asset.id}`, { method: "PATCH", headers: { cookie, origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ name: "Updated mark" }) })).status).toBe(200);
      expect((await call(restarted, `/api/assets/${asset.id}`, { method: "DELETE", headers: { cookie, origin: "http://localhost" } })).status).toBe(200);
      expect((await call(restarted, `/api/assets/${asset.id}/image`, { headers: { cookie } })).status).toBe(404);
      expect((await call(restarted, `/api/assets/${asset.id}`, { method: "DELETE", headers: { cookie } })).status).toBe(404);
    } finally {
      if (assetId) await database.db.delete(imageAsset).where(eq(imageAsset.id, assetId));
      if (id) await database.db.delete(user).where(eq(user.id, id));
      if (reopened) await reopened.close();
      await database.close();
    }
  });
});
