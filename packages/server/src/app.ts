import { Elysia } from "elysia";
import { frontendResponse } from "@ruf/frontend";
import type { Database } from "./db";
import { createAuth } from "./auth";
import { draftRoutes } from "./drafts";
import { assetRoutes } from "./assets";
import { authenticateMcpKey, keyRoutes } from "./keys";

export function createApp(db: Database, config: { secret: string; baseURL: string }) {
  const auth = createAuth(db, config);
  const keys = keyRoutes(db, auth);
  return new Elysia()
    .onRequest(async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        if (!await authenticateMcpKey(db, request.headers.get("authorization"))) {
          return Response.json({ error: "Valid MCP key required" }, { status: 401 });
        }
        return Response.json({ error: "MCP is not implemented" }, { status: 501 });
      }
      // Invitation-only registration is a later feature. Better Auth's generic
      // signup (and all other unreviewed auth endpoints) must never become public.
      if (pathname.startsWith("/api/auth/") && ![
        "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/get-session",
      ].includes(pathname)) return Response.json({ error: "Registration requires an invitation" }, { status: 403 });
      if ((pathname === "/api" || pathname.startsWith("/api/")) &&
        pathname !== "/api/health" && pathname !== "/api/bulletins" && !pathname.startsWith("/api/bulletins/") && !pathname.startsWith("/api/auth/") &&
        !/^\/api\/assets(?:\/[0-9a-f-]{36}(?:\/image)?)?$/i.test(pathname) &&
        !["/api/staff", "/api/keys"].includes(pathname) && !/^\/api\/keys\/[^/]+\/revoke$/.test(pathname)) {
        return Response.json({ error: "Unknown API route" }, { status: 404 });
      }
      if (pathname === "/api/health" && request.method !== "GET") return Response.json({ error: "Unknown API route" }, { status: 404 });
    })
    .get("/api/health", () => ({ status: "ok" }))
    .all("/api/auth/*", ({ request }) => auth.handler(request))
    .use(assetRoutes(db, auth))
    .use(draftRoutes(db, auth))
    .get("/api/staff", ({ request, set }) => keys.staff(request.headers, set))
    .get("/api/keys", ({ request, set }) => keys.list(request.headers, set))
    .post("/api/keys", ({ request, body, set }) => keys.issue(request.headers, body as { userId?: string; label?: string }, set, new URL(config.baseURL).origin))
    .post("/api/keys/:id/revoke", ({ request, params, set }) => keys.revoke(request.headers, params.id, set, new URL(config.baseURL).origin))
    .get("/*", async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/sign-in" && !pathname.includes(".") &&
        !(await auth.api.getSession({ headers: request.headers }))) {
        return Response.redirect(new URL("/sign-in", request.url), 302);
      }
      return frontendResponse(pathname);
    });
}

export type App = ReturnType<typeof createApp>;
