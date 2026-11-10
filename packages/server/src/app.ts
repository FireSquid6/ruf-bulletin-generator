import { Elysia } from "elysia";
import { frontendResponse } from "@ruf/frontend";
import type { Database } from "./db";
import { createAuth } from "./auth";
import { draftRoutes } from "./drafts";
import { assetRoutes } from "./assets";

export function createApp(db: Database, config: { secret: string; baseURL: string }) {
  const auth = createAuth(db, config);
  return new Elysia()
    .onRequest(({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        return Response.json({ error: "MCP is not implemented" }, { status: 501 });
      }
      // Invitation-only registration is a later feature. Better Auth's generic
      // signup (and all other unreviewed auth endpoints) must never become public.
      if (pathname.startsWith("/api/auth/") && ![
        "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/get-session",
      ].includes(pathname)) return Response.json({ error: "Registration requires an invitation" }, { status: 403 });
      if ((pathname === "/api" || pathname.startsWith("/api/")) &&
        pathname !== "/api/health" && pathname !== "/api/bulletins" && !pathname.startsWith("/api/bulletins/") && !pathname.startsWith("/api/auth/") && !/^\/api\/assets(?:\/[0-9a-f-]{36}(?:\/image)?)?$/i.test(pathname)) {
        return Response.json({ error: "Unknown API route" }, { status: 404 });
      }
      if (pathname === "/api/health" && request.method !== "GET") return Response.json({ error: "Unknown API route" }, { status: 404 });
    })
    .get("/api/health", () => ({ status: "ok" }))
    .all("/api/auth/*", ({ request }) => auth.handler(request))
    .use(assetRoutes(db, auth))
    .use(draftRoutes(db, auth))
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
