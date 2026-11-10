import { Elysia } from "elysia";
import { frontendResponse } from "@ruf/frontend";

export function createApp() {
  return new Elysia()
    .onRequest(({ request }) => {
      const pathname = new URL(request.url).pathname;
      // The frontend wildcard must never swallow reserved server namespaces.
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        return Response.json({ error: "MCP is not implemented" }, { status: 501 });
      }
      if ((pathname === "/api" || pathname.startsWith("/api/")) &&
          !(pathname === "/api/health" && request.method === "GET")) {
        return Response.json({ error: "Unknown API route" }, { status: 404 });
      }
    })
    .get("/api/health", () => ({ status: "ok" }))
    .get("/*", ({ request }) => frontendResponse(new URL(request.url).pathname));
}

// Eden consumes this type without importing the server implementation into the browser.
export type App = ReturnType<typeof createApp>;
