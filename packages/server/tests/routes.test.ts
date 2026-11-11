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

  test("MCP requires a bearer key and unknown paths do not fall through", async () => {
    const response = await request("/mcp", "POST");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Valid MCP key required" });
    expect((await request("/mcp/example", "POST")).status).toBe(404);
  });

  test("MCP rejects foreign origins and hosts before key authentication", async () => {
    for (const [url, origin] of [
      ["http://localhost/mcp", "https://foreign.example"],
      ["http://foreign.example/mcp", "http://localhost"],
    ]) {
      const response = await app.handle(new Request(url, { method: "POST", headers: { origin } }));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Invalid MCP origin" });
    }
  });

  test("reserved API methods do not reach the React fallback", async () => {
    for (const [path, method] of [["/api/register", "GET"], ["/api/invitations", "DELETE"]]) {
      const response = await request(path, method);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Unknown API route" });
    }
    expect((await request("/api/auth/change-password", "POST")).status).toBe(403);
    expect((await request("/api/songs", "POST")).status).toBe(401);
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
