import { Elysia } from "elysia";
import { frontendResponse } from "@ruf/frontend";
import type { Database } from "./db";
import { createAuth } from "./auth";
import type { AuthConfig } from "./auth";
import { draftRoutes } from "./drafts";
import { pdfRoutes } from "./pdf";
import { assetRoutes } from "./assets";
import { authenticateMcpKey, keyRoutes } from "./keys";
import { invitationRoutes } from "./invitations";
import { songRoutes } from "./songs";
import { createMcpEndpoint } from "./mcp";

export function createApp(db: Database, config: AuthConfig) {
  const auth = createAuth(db, config);
  const keys = keyRoutes(db, auth, config.emailConfirmation);
  const mcp = createMcpEndpoint(db);
  const appURL = new URL(config.baseURL);

  // Reject anonymous song requests before Elysia validates their bodies.
  // The song routes use the shared store without their own session guard.
  async function requireSongSession(request: Request, pathname: string) {
    if (pathname === "/api/songs" || pathname.startsWith("/api/songs/")) {
      if (!await auth.api.getSession({ headers: request.headers })) return Response.json({ error: "Sign in required" }, { status: 401 });
    }
  }

  // MCP is handled entirely by the SDK. Check host/origin against DNS rebinding
  // and authenticate EVERY request so revocation blocks already-connected clients.
  async function handleMcpRequest(request: Request, pathname: string) {
    if (pathname !== "/mcp" && !pathname.startsWith("/mcp/")) return;
    if (pathname !== "/mcp") return Response.json({ error: "Unknown MCP route" }, { status: 404 });
    const origin = request.headers.get("origin");
    if ((origin && origin !== appURL.origin) || new URL(request.url).host !== appURL.host) {
      return Response.json({ error: "Invalid MCP origin" }, { status: 403 });
    }
    const authorization = request.headers.get("authorization");
    const identity = await authenticateMcpKey(db, authorization, config.emailConfirmation);
    if (!identity) {
      return Response.json({ error: "Valid MCP key required" }, { status: 401, headers: { "cache-control": "no-store" } });
    }
    return mcp.fetch(request, { authInfo: { token: authorization!.slice(7), clientId: identity.id, scopes: [] } });
  }

  // Signup is only called server-side after atomically claiming an invitation.
  function restrictAuthEndpoints(pathname: string, method: string) {
    if (method === "GET" && /^\/api\/auth\/reset-password\/[^/]+$/.test(pathname)) return;
    if (pathname.startsWith("/api/auth/") && ![
      "/api/auth/sign-in/email", "/api/auth/sign-out", "/api/auth/get-session",
      "/api/auth/request-password-reset", "/api/auth/reset-password",
      ...(config.emailConfirmation ? ["/api/auth/send-verification-email", "/api/auth/verify-email"] : []),
    ].includes(pathname)) return Response.json({ error: "Registration requires an invitation" }, { status: 403 });
  }

  // Keep unknown API requests out of the GET /* React fallback. This routing
  // allowlist is NOT authorization; API modules still enforce session/role rules.
  function rejectUnknownApiRoutes(request: Request, pathname: string) {
    if ((pathname === "/api" || pathname.startsWith("/api/")) &&
      pathname !== "/api/health" && pathname !== "/api/bulletins" && !pathname.startsWith("/api/bulletins/") && !pathname.startsWith("/api/auth/") &&
      !/^\/api\/assets(?:\/[0-9a-f-]{36}(?:\/image)?)?$/i.test(pathname) &&
      !["/api/account-policy", "/api/session", "/api/staff", "/api/keys", "/api/register", "/api/invitations"].includes(pathname) &&
      !/^\/api\/keys\/[^/]+\/revoke$/.test(pathname) &&
      pathname !== "/api/songs" && !pathname.startsWith("/api/songs/")) {
      return Response.json({ error: "Unknown API route" }, { status: 404 });
    }
    if (["/api/health", "/api/account-policy", "/api/session"].includes(pathname) && request.method !== "GET") return Response.json({ error: "Unknown API route" }, { status: 404 });
    if ((pathname === "/api/register" && request.method !== "POST") || (pathname === "/api/invitations" && !["GET", "POST"].includes(request.method))) return Response.json({ error: "Unknown API route" }, { status: 404 });
  }

  return new Elysia()
    // Runs before body parsing/route validation. Returning a Response ends the
    // request; returning nothing lets the registered routes below handle it.
    .onRequest(async ({ request }) => {
      const pathname = new URL(request.url).pathname;
      const blockedAuth = restrictAuthEndpoints(pathname, request.method);
      if (blockedAuth) return blockedAuth;
      // A session and an MCP key both remain unusable until email confirmation.
      // Keep only recovery, confirmation and public access flows available.
      if (config.emailConfirmation && pathname.startsWith("/api/") && ![
        "/api/health", "/api/account-policy", "/api/session", "/api/register", "/api/auth/sign-in/email", "/api/auth/sign-out",
        "/api/auth/get-session", "/api/auth/request-password-reset", "/api/auth/reset-password",
        "/api/auth/send-verification-email", "/api/auth/verify-email",
      ].includes(pathname)) {
        if (!/^\/api\/auth\/reset-password\/[^/]+$/.test(pathname)) {
          const staff = await auth.api.getSession({ headers: request.headers });
          if (staff && !staff.user.emailVerified) return Response.json({ error: "Confirm your email address before using the workspace" }, { status: 403 });
        }
      }
      return await requireSongSession(request, pathname)
        ?? await handleMcpRequest(request, pathname)
        ?? rejectUnknownApiRoutes(request, pathname);
    })
    .get("/api/health", () => ({ status: "ok" }))
    .get("/api/account-policy", () => ({ emailConfirmation: config.emailConfirmation === true }))
    .get("/api/session", async ({ request }) => {
      const staff = await auth.api.getSession({ headers: request.headers });
      return Response.json(staff ? { user: staff.user, confirmationRequired: config.emailConfirmation === true } : null, { headers: { "cache-control": "no-store" } });
    })
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
      if (!["/sign-in", "/register", "/forgot-password", "/reset-password", "/verify-email"].includes(pathname) && !pathname.includes(".")) {
        const staff = await auth.api.getSession({ headers: request.headers });
        if (!staff) return Response.redirect(new URL("/sign-in", request.url), 302);
        if (config.emailConfirmation && !staff.user.emailVerified) return Response.redirect(new URL("/verify-email", request.url), 302);
      }
      return frontendResponse(pathname);
    });
}

export type App = ReturnType<typeof createApp>;
