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
      expect(response.status).toBe(501);
      expect(await response.json()).toEqual({ error: "MCP is not implemented" });
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
    expect((await request(script![1])).status).toBe(200);
    expect((await request("/bulletins/new")).status).toBe(302);
    expect((await request("/missing.js")).status).toBe(404);
  });
});
