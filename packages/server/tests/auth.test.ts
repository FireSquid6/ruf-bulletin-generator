import { describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { bootstrapAdmin } from "../src/bootstrap";

// Set TEST_DATABASE_URL to a disposable migrated Postgres database; never use production data.
const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("authentication at the HTTP boundary (Postgres)", () => {
  test("bootstrap once, reject public signup, require a persisted session, and revoke it on logout", async () => {
    const database = createDatabase(url!);
    try {
      const app = createApp(database.db, { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" });
      const call = (path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init));
      expect((await call("/api/bulletins")).status).toBe(401);
      expect((await call("/api/auth/sign-up/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ email: "stranger@example.org", password: "password123", name: "Stranger" }) })).status).toBe(403);
      const email = `admin-${crypto.randomUUID()}@example.org`;
      const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
      await bootstrapAdmin(database.db, { email, password: "valid-password-123", name: "Administrator" }, config);
      await expect(bootstrapAdmin(database.db, { email: "second@example.org", password: "valid-password-123", name: "Second" }, config)).rejects.toThrow();
      const login = await call("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify({ email, password: "valid-password-123" }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const otherApp = createApp(database.db, config);
      const persisted = (path: string, init?: RequestInit) => otherApp.handle(new Request(`http://localhost${path}`, init));
      expect((await persisted("/", { headers: { cookie } })).status).toBe(200);
      expect((await persisted("/api/bulletins", { headers: { cookie } })).json()).resolves.toEqual({ bulletins: [] });
      const logout = await call("/api/auth/sign-out", { method: "POST", headers: { cookie, origin: "http://localhost" } });
      expect(logout.status).toBe(200);
      expect((await persisted("/api/bulletins", { headers: { cookie } })).status).toBe(401);
    } finally {
      await database.close();
    }
  });
});
