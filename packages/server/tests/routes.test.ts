import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createDatabase } from "../src/db";

const db = createDatabase("postgres://localhost/ruf_unused");
const app = createApp(db.db, { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" });
const request = (path: string, method = "GET") => app.handle(new Request(`http://localhost${path}`, { method }));

describe("server route boundaries", () => {
  test("API routes do not fall through to React", async () => {
    expect(await (await request("/api/health")).json()).toEqual({ status: "ok" });
    const missing = await request("/api/missing");
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Unknown API route" });
    expect((await request("/api")).status).toBe(404);
    expect((await request("/api/health", "POST")).status).toBe(404);
    expect((await request("/api/auth/sign-up/email", "POST")).status).toBe(403);
    expect((await request("/api/assets")).status).toBe(401);
    expect((await request("/api/assets/unknown")).status).toBe(404);
  });

  test("MCP is explicit about being unavailable", async () => {
    for (const url of ["/mcp", "/mcp/example"]) {
      const response = await request(url, "POST");
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Valid MCP key required" });
    }
  });

  test("frontend serves sign-in but redirects protected navigation", async () => {
    const page = await request("/");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("http://localhost/sign-in");
    const html = await (await request("/sign-in")).text();
    expect(html).toContain("RUF Bulletin Studio");
    const script = html.match(/src="([^"]+\.js)"/);
    expect(script).not.toBeNull();
    const bundle = await request(script![1]);
    expect(bundle.status).toBe(200);
    const source = await bundle.text();
    // The HTML entrypoint must ship the new draft screens alongside the
    // existing image, invitation, and MCP credential navigation.
    for (const label of ["Create draft", "/bulletins/new", "/api/assets/", "Staff invitations", "MCP credentials", "/register"]) {
      expect(source).toContain(label);
    }
    expect(source).not.toContain("/ruf-baylor-logo.png");
    expect((await request("/bulletins/new")).status).toBe(302);
    expect((await request("/missing.js")).status).toBe(404);
  });
});
