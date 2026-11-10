import { Elysia } from "elysia";
import { frontendResponse } from "@ruf/frontend";
import type { Database } from "./db";
import { createAuth } from "./auth";
import { draftRoutes } from "./drafts";
import { assetRoutes } from "./assets";
import { authenticateMcpKey, keyRoutes } from "./keys";
import { invitationRoutes } from "./invitations";
import { songRoutes } from "./songs";
import { createMcpEndpoint } from "./mcp";

export function createApp(db: Database, config: { secret: string; baseURL: string }) {
  const auth = createAuth(db, config);
  const keys = keyRoutes(db, auth);
  const mcp = createMcpEndpoint(db);
  return new Elysia()
    .onRequest(async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname === "/api/songs" || pathname.startsWith("/api/songs/")) {
        if (!await auth.api.getSession({ headers: request.headers })) return Response.json({ error: "Sign in required" }, { status: 401 });
      }
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        if (pathname !== "/mcp") return Response.json({ error: "Unknown MCP route" }, { status: 404 });
        const origin = new URL(config.baseURL).origin;
        if (request.headers.get("origin") && request.headers.get("origin") !== origin || new URL(request.url).host !== new URL(config.baseURL).host) {
          return Response.json({ error: "Invalid MCP origin" }, { status: 403 });
        }
        const authorization = request.headers.get("authorization");
        const identity = await authenticateMcpKey(db, authorization);
        if (!identity) {
          return Response.json({ error: "Valid MCP key required" }, { status: 401, headers: { "cache-control": "no-store" } });
        }
        return mcp.fetch(request, { authInfo: { token: authorization!.slice(7), clientId: identity.id, scopes: [] } });
      }
      // Only these Better Auth endpoints are public; signup is exclusively
      // performed server-side after atomically claiming an invitation.
      if (pathname.startsWith("/api/auth/") && ![
        "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/get-session",
      ].includes(pathname)) return Response.json({ error: "Registration requires an invitation" }, { status: 403 });
      if ((pathname === "/api" || pathname.startsWith("/api/")) &&
        pathname !== "/api/health" && pathname !== "/api/bulletins" && !pathname.startsWith("/api/bulletins/") && !pathname.startsWith("/api/auth/") &&
        !/^\/api\/assets(?:\/[0-9a-f-]{36}(?:\/image)?)?$/i.test(pathname) &&
        !["/api/staff", "/api/keys", "/api/register", "/api/invitations"].includes(pathname) &&
        !/^\/api\/keys\/[^/]+\/revoke$/.test(pathname) &&
        pathname !== "/api/songs" && !pathname.startsWith("/api/songs/")) {
        return Response.json({ error: "Unknown API route" }, { status: 404 });
      }
      if (pathname === "/api/health" && request.method !== "GET") return Response.json({ error: "Unknown API route" }, { status: 404 });
      if (pathname === "/api/register" && request.method !== "POST" || pathname === "/api/invitations" && !["GET", "POST"].includes(request.method)) return Response.json({ error: "Unknown API route" }, { status: 404 });
    })
    .get("/api/health", () => ({ status: "ok" }))
    .all("/api/auth/*", ({ request }) => auth.handler(request))
    .use(assetRoutes(db, auth))
    .use(draftRoutes(db, auth))
    .get("/api/staff", ({ request, set }) => keys.staff(request.headers, set))
    .get("/api/keys", ({ request, set }) => keys.list(request.headers, set))
    .post("/api/keys", ({ request, body, set }) => keys.issue(request.headers, body as { userId?: string; label?: string }, set, new URL(config.baseURL).origin))
    .post("/api/keys/:id/revoke", ({ request, params, set }) => keys.revoke(request.headers, params.id, set, new URL(config.baseURL).origin))
    .use(invitationRoutes(db, auth, new URL(config.baseURL).origin))
    .use(songRoutes(db))
    .get("/*", async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/sign-in" && pathname !== "/register" && !pathname.includes(".") &&
        !(await auth.api.getSession({ headers: request.headers }))) {
        return Response.redirect(new URL("/sign-in", request.url), 302);
      }
      return frontendResponse(pathname);
    });
}

export type App = ReturnType<typeof createApp>;
