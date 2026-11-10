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
      const json = (value: unknown, session?: string): RequestInit => ({ method: "POST", headers: { "content-type": "application/json", origin: "http://localhost", ...(session ? { cookie: session } : {}) }, body: JSON.stringify(value) });
      expect((await call("/api/invitations", json({}))).status).toBe(401);
      expect((await call("/api/register", json({ email: `guess-${crypto.randomUUID()}@example.org`, password: "valid-password-123", invitationKey: "AAAAAAAAAAAAAAAA" }))).status).toBe(400);
      const issued = await call("/api/invitations", json({}, cookie));
      expect(issued.status).toBe(201);
      const { key } = await issued.json() as { key: string };
      expect(key).toMatch(/^[A-Za-z0-9_-]{16}$/);
      expect(JSON.stringify(await (await call("/api/invitations", { headers: { cookie } })).json())).not.toContain(key);
      expect((await call("/api/invitations", { method: "POST", headers: { cookie, origin: "https://other.example.org" } })).status).toBe(403);
      const staffEmail = `staff-${crypto.randomUUID()}@example.org`;
      expect((await call("/api/register", json({ email: staffEmail, password: "short", invitationKey: key }))).status).toBe(400);
      expect((await call("/api/register", json({ email: staffEmail, password: "valid-password-123", invitationKey: key }))).status).toBe(201);
      expect((await call("/api/register", json({ email: `reuse-${crypto.randomUUID()}@example.org`, password: "valid-password-123", invitationKey: key }))).status).toBe(400);
      const staffLogin = await call("/api/auth/sign-in/email", json({ email: staffEmail, password: "valid-password-123" }));
      expect(staffLogin.status).toBe(200);
      const staffCookie = staffLogin.headers.get("set-cookie")!.split(";")[0];
      expect((await call("/api/bulletins", { headers: { cookie: staffCookie } })).status).toBe(200);
      expect((await call("/api/assets", { headers: { cookie: staffCookie } })).status).toBe(200);
      expect((await call("/api/invitations", json({}, staffCookie))).status).toBe(403);
      expect((await call("/api/invitations", { headers: { cookie: staffCookie } })).status).toBe(403);
      const retry = await call("/api/invitations", json({}, cookie));
      const { key: retryKey } = await retry.json() as { key: string };
      expect((await call("/api/register", json({ email: staffEmail, password: "valid-password-123", invitationKey: retryKey }))).status).toBe(400);
      expect((await call("/api/register", json({ email: `retry-${crypto.randomUUID()}@example.org`, password: "valid-password-123", invitationKey: retryKey }))).status).toBe(201);
      const second = await call("/api/invitations", json({}, cookie));
      const { key: concurrentKey } = await second.json() as { key: string };
      const attempts = await Promise.all([1, 2].map(n => call("/api/register", json({ email: `race-${n}-${crypto.randomUUID()}@example.org`, password: "valid-password-123", invitationKey: concurrentKey }))));
      expect(attempts.map(response => response.status).sort()).toEqual([201, 400]);
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
