import { describe, expect, test } from "bun:test";
import { createDatabase } from "../src/db";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { user } from "../src/schema";
import { eq } from "drizzle-orm";
import { authenticateMcpKey } from "../src/keys";

const url = process.env.TEST_DATABASE_URL;
const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };

describe.skipIf(!url)("MCP credentials at the Postgres HTTP boundary", () => {
  test("admin issues multiple staff-bound keys; secrets are one-time, revoked and invalid keys are rejected", async () => {
    const database = createDatabase(url!);
    try {
      const auth = createAuth(database.db, config);
      const adminEmail = `admin-${crypto.randomUUID()}@example.org`;
      const staffEmail = `staff-${crypto.randomUUID()}@example.org`;
      const password = "valid-password-123";
      const admin = await auth.api.signUpEmail({ body: { name: "Admin", email: adminEmail, password } });
      await database.db.update(user).set({ role: "admin" }).where(eq(user.id, admin.user.id));
      const staff = await auth.api.signUpEmail({ body: { name: "Staff Member", email: staffEmail, password } });
      const app = createApp(database.db, config);
      const call = (path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init));
      const login = async (email: string) => {
        const response = await call("/api/auth/sign-in/email", { method: "POST", headers: { origin: config.baseURL, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
        expect(response.status).toBe(200);
        return response.headers.get("set-cookie")!.split(";")[0];
      };
      const adminCookie = await login(adminEmail);
      const staffCookie = await login(staffEmail);
      const post = (path: string, cookie: string, body?: object) => call(path, { method: "POST", headers: { cookie, origin: config.baseURL, "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

      expect((await call("/api/keys")).status).toBe(401);
      expect((await call("/api/staff", { headers: { cookie: staffCookie } })).status).toBe(403);
      expect((await call("/api/keys", { headers: { cookie: staffCookie } })).status).toBe(403);
      expect((await post("/api/keys", staffCookie, { userId: staff.user.id, label: "Laptop" })).status).toBe(403);
      expect((await call("/api/keys", { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json", origin: "http://other.invalid" }, body: JSON.stringify({ userId: staff.user.id, label: "Laptop" }) })).status).toBe(403);
      expect((await post("/api/keys", adminCookie, { userId: "missing", label: "Laptop" })).status).toBe(400);
      expect((await post("/api/keys", adminCookie, { userId: staff.user.id, label: " " })).status).toBe(400);
      const staffList = await (await call("/api/staff", { headers: { cookie: adminCookie } })).json();
      expect(staffList.staff).toContainEqual({ id: staff.user.id, name: "Staff Member", email: staffEmail });

      const first = await post("/api/keys", adminCookie, { userId: staff.user.id, label: "Laptop" });
      expect(first.status).toBe(201);
      expect(first.headers.get("cache-control")).toContain("no-store");
      const issued = await first.json();
      expect(issued.secret).toMatch(/^ruf_mcp_[A-Za-z0-9_-]{43}$/);
      const second = await (await post("/api/keys", adminCookie, { userId: staff.user.id, label: "Desktop" })).json();
      expect(second.secret).not.toBe(issued.secret);
      const listing = await (await call("/api/keys", { headers: { cookie: adminCookie } })).text();
      expect(listing).toContain("Laptop");
      expect(listing).toContain("Desktop");
      expect(listing).toContain(staffEmail);
      expect(listing).not.toContain(issued.secret);
      expect(listing).not.toContain(second.secret);
      expect(listing).not.toContain("hash");
      expect((await call("/api/keys", { headers: { authorization: `Bearer ${issued.secret}` } })).status).toBe(401);
      expect((await call("/api/auth/sign-up/email", { method: "POST", headers: { authorization: `Bearer ${issued.secret}`, origin: config.baseURL, "content-type": "application/json" }, body: JSON.stringify({ email: "unauthorized@example.org", password, name: "Unauthorized" }) })).status).toBe(403);

      // Content tools do not exist yet, but the MCP boundary must authenticate before the 501 placeholder.
      expect((await call("/mcp", { method: "POST" })).status).toBe(401);
      expect((await call("/mcp", { method: "POST", headers: { authorization: "Bearer invalid" } })).status).toBe(401);
      expect((await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${issued.secret}` } })).status).toBe(501);
      expect(await authenticateMcpKey(database.db, `Bearer ${issued.secret}`)).toEqual({ id: staff.user.id, name: "Staff Member", email: staffEmail });
      const adminOwned = await (await post("/api/keys", adminCookie, { userId: admin.user.id, label: "Admin's laptop" })).json();
      expect(await authenticateMcpKey(database.db, `Bearer ${adminOwned.secret}`)).toEqual({ id: admin.user.id, name: "Admin", email: adminEmail });
      expect((await call("/api/keys", { headers: { authorization: `Bearer ${adminOwned.secret}` } })).status).toBe(401);
      expect((await post(`/api/keys/${issued.key.id}/revoke`, staffCookie)).status).toBe(403);
      expect((await post(`/api/keys/${issued.key.id}/revoke`, adminCookie)).status).toBe(200);
      expect((await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${issued.secret}` } })).status).toBe(401);
      expect(await authenticateMcpKey(database.db, `Bearer ${issued.secret}`)).toBeNull();
      expect((await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${second.secret}` } })).status).toBe(501);
      expect((await post(`/api/keys/${issued.key.id}/revoke`, adminCookie)).status).toBe(404);
      const after = await (await call("/api/keys", { headers: { cookie: adminCookie } })).json();
      expect(after.keys.find((key: { id: string }) => key.id === issued.key.id).revokedAt).toBeTruthy();
    } finally {
      await database.close();
    }
  });
});
