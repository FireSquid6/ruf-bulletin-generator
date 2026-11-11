import { describe, expect, test } from "bun:test";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDatabase } from "../src/db";
import { mcpKey, user } from "../src/schema";

test("only reset and opted-in verification endpoints are exposed without a database session", async () => {
  const database = createDatabase("postgres://localhost/unused");
  try {
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const off = createApp(database.db, config);
    const on = createApp(database.db, { ...config, emailConfirmation: true });
    const request = (path: string, method = "GET") => new Request(`http://localhost${path}`, { method });
    expect(await (await off.handle(request("/api/account-policy"))).json()).toEqual({ emailConfirmation: false });
    expect(await (await on.handle(request("/api/account-policy"))).json()).toEqual({ emailConfirmation: true });
    expect(await (await on.handle(request("/api/session"))).json()).toBeNull();
    expect((await off.handle(request("/api/auth/sign-up/email", "POST"))).status).toBe(403);
    expect((await on.handle(request("/api/auth/sign-up/email", "POST"))).status).toBe(403);
    expect((await off.handle(request("/api/auth/send-verification-email", "POST"))).status).toBe(403);
    expect((await off.handle(request("/api/auth/verify-email"))).status).toBe(403);
    expect((await off.handle(request("/api/auth/reset-password/not-a-token", "POST"))).status).toBe(403);
  } finally { await database.close(); }
});

describe.skipIf(!process.env.TEST_DATABASE_URL)("email confirmation and recovery (Postgres)", () => {
  test("gates web and MCP until confirmed; reset tokens are single-use and revoke sessions", async () => {
    const database = createDatabase(process.env.TEST_DATABASE_URL!);
    const messages: { to: string; subject: string; text: string }[] = [];
    const config = {
      secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost",
      emailConfirmation: true,
      mailer: { async send(message: { to: string; subject: string; text: string }) { messages.push(message); } },
    };
    try {
      const email = `confirm-${randomUUID()}@example.org`;
      const password = "valid-password-123";
      const auth = createAuth(database.db, config);
      const created = await auth.api.signUpEmail({ body: { email, name: "Confirm test", password } });
      expect(messages.some(message => message.subject === "Confirm your email address" && message.to === email)).toBe(true);
      const app = createApp(database.db, config);
      const call = (path: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, init));
      const post = (path: string, body: object, cookie?: string) => call(path, { method: "POST", headers: { origin: config.baseURL, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });

      const secret = `ruf_mcp_${randomBytes(32).toString("base64url")}`;
      await database.db.insert(mcpKey).values({ id: randomUUID(), userId: created.user.id, label: "Existing key", secretHash: createHash("sha256").update(secret).digest("hex") });
      expect((await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${secret}` } })).status).toBe(401);
      expect((await post("/api/auth/sign-in/email", { email, password })).status).toBe(403);
      expect((await post("/api/auth/send-verification-email", { email, callbackURL: "/verify-email?confirmed=1" })).status).toBe(200);
      const confirmation = messages.at(-1)!.text.match(/https?:\/\/\S+/)![0];
      const verified = await call(new URL(confirmation).pathname + new URL(confirmation).search);
      expect(verified.status).toBe(302);
      expect(verified.headers.get("location")).toContain("/verify-email?confirmed=1");
      const login = await post("/api/auth/sign-in/email", { email, password });
      expect(login.status).toBe(200);
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      expect((await call("/api/bulletins", { headers: { cookie } })).status).toBe(200);
      expect((await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${secret}` } })).status).toBe(415);

      // Re-check persisted verification on every request, even for an old session/key.
      await database.db.update(user).set({ emailVerified: false }).where(eq(user.id, created.user.id));
      expect((await call("/api/bulletins", { headers: { cookie } })).status).toBe(403);
      expect((await call("/mcp", { method: "POST", headers: { authorization: `Bearer ${secret}` } })).status).toBe(401);
      await database.db.update(user).set({ emailVerified: true }).where(eq(user.id, created.user.id));

      expect((await post("/api/auth/request-password-reset", { email: `unknown-${randomUUID()}@example.org`, redirectTo: "http://localhost/reset-password" })).status).toBe(200);
      expect((await post("/api/auth/request-password-reset", { email, redirectTo: "http://localhost/reset-password" })).status).toBe(200);
      const resetLink = messages.at(-1)!.text.match(/https?:\/\/\S+/)![0];
      const resetURL = new URL(resetLink);
      const redirect = await call(resetURL.pathname + resetURL.search);
      expect(redirect.status).toBe(302);
      const token = new URL(redirect.headers.get("location")!).searchParams.get("token")!;
      expect(token).toBeTruthy();
      expect((await post("/api/auth/reset-password", { token, newPassword: "updated-password-456" })).status).toBe(200);
      expect((await post("/api/auth/reset-password", { token, newPassword: "another-password-789" })).status).toBe(400);
      expect((await call("/api/bulletins", { headers: { cookie } })).status).toBe(401);
      expect((await post("/api/auth/sign-in/email", { email, password })).status).toBe(401);
      expect((await post("/api/auth/sign-in/email", { email, password: "updated-password-456" })).status).toBe(200);

      const noConfirmation = createApp(database.db, { ...config, emailConfirmation: false });
      const unchecked = await createAuth(database.db, { ...config, emailConfirmation: false }).api.signUpEmail({ body: { email: `dev-${randomUUID()}@example.org`, name: "Dev", password } });
      expect(unchecked.user.emailVerified).toBe(false);
      const devLogin = await noConfirmation.handle(new Request("http://localhost/api/auth/sign-in/email", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ email: unchecked.user.email, password }) }));
      expect(devLogin.status).toBe(200);
      const devCookie = devLogin.headers.get("set-cookie")!.split(";")[0];
      expect((await noConfirmation.handle(new Request("http://localhost/api/bulletins", { headers: { cookie: devCookie } }))).status).toBe(200);
    } finally {
      await database.close();
    }
  });
});
