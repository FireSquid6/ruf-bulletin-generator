import { Elysia } from "elysia";
import { frontendResponse } from "@ruf/frontend";
import type { Database } from "./db";
import { createAuth } from "./auth";
import { draftRoutes } from "./drafts";
import { pdfRoutes } from "./pdf";
import { assetRoutes } from "./assets";
import { authenticateMcpKey, keyRoutes } from "./keys";
import { invitationRoutes } from "./invitations";
import { songRoutes } from "./songs";
import { createMcpEndpoint } from "./mcp";

export function createApp(db: Database, config: { secret: string; baseURL: string }) {
  const auth = createAuth(db, config);
  const keys = keyRoutes(db, auth);
  const mcp = createMcpEndpoint(db);
  const appURL = new URL(config.baseURL);
  return new Elysia()
    // Runs before body parsing/route validation. Returning a Response ends the
    // request; returning nothing lets the registered routes below handle it.
    .onRequest(async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      // 1. Reject anonymous song requests before Elysia validates their bodies.
      // The song routes use the shared store without their own session guard.
      if (pathname === "/api/songs" || pathname.startsWith("/api/songs/")) {
        if (!await auth.api.getSession({ headers: request.headers })) return Response.json({ error: "Sign in required" }, { status: 401 });
      }
      if (pathname === "/mcp" || pathname.startsWith("/mcp/")) {
        // 2. MCP is a separate protocol, handled entirely by the SDK. Check the
        // host/origin (DNS-rebinding protection), then a key on EVERY request
        // so revoking a key also blocks clients that already connected.
        if (pathname !== "/mcp") return Response.json({ error: "Unknown MCP route" }, { status: 404 });
        const origin = request.headers.get("origin");
        if ((origin && origin !== appURL.origin) || new URL(request.url).host !== appURL.host) {
          return Response.json({ error: "Invalid MCP origin" }, { status: 403 });
        }
        const authorization = request.headers.get("authorization");
        const identity = await authenticateMcpKey(db, authorization);
        if (!identity) {
          return Response.json({ error: "Valid MCP key required" }, { status: 401, headers: { "cache-control": "no-store" } });
        }
        return mcp.fetch(request, { authInfo: { token: authorization!.slice(7), clientId: identity.id, scopes: [] } });
      }
      // 3. Limit the Better Auth wildcard route below to these public endpoints.
      // Signup is only called server-side after atomically claiming an invitation.
      if (pathname.startsWith("/api/auth/") && ![
        "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/get-session",
      ].includes(pathname)) return Response.json({ error: "Registration requires an invitation" }, { status: 403 });
      // 4. Reserve the API namespace: unknown paths must return JSON 404, not
      // index.html from the GET /* React fallback. This is a routing allowlist,
      // NOT authorization; each API module still enforces its session/role rules.
      if ((pathname === "/api" || pathname.startsWith("/api/")) &&
        pathname !== "/api/health" && pathname !== "/api/bulletins" && !pathname.startsWith("/api/bulletins/") && !pathname.startsWith("/api/auth/") &&
        !/^\/api\/assets(?:\/[0-9a-f-]{36}(?:\/image)?)?$/i.test(pathname) &&
        !["/api/staff", "/api/keys", "/api/register", "/api/invitations"].includes(pathname) &&
        !/^\/api\/keys\/[^/]+\/revoke$/.test(pathname) &&
        pathname !== "/api/songs" && !pathname.startsWith("/api/songs/")) {
        return Response.json({ error: "Unknown API route" }, { status: 404 });
      }
      if (pathname === "/api/health" && request.method !== "GET") return Response.json({ error: "Unknown API route" }, { status: 404 });
      if ((pathname === "/api/register" && request.method !== "POST") || (pathname === "/api/invitations" && !["GET", "POST"].includes(request.method))) return Response.json({ error: "Unknown API route" }, { status: 404 });
    })
    .get("/api/health", () => ({ status: "ok" }))
    .all("/api/auth/*", ({ request }) => auth.handler(request))
    .use(assetRoutes(db, auth))
    .use(draftRoutes(db, auth))
    .use(pdfRoutes(db, auth))
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
