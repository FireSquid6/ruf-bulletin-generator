# Application stack decisions

These are the libraries chosen for future product implementation; installing them does not mean the unfinished editor, authentication, or MCP endpoints are operational. Follow [PRODUCT.md](../../PRODUCT.md) for behavior and [docs/design/EDITOR.md](../design/EDITOR.md) for UX constraints.

## Frontend (`packages/frontend`)

- Use **React Router** (`react-router`) for multi-page navigation and route state.
- Use **React Hook Form** (`react-hook-form`) for editable forms and draft field arrays. Apply draft-permissive validation; PDF generation errors are a separate concern.
- Use **Elysia Eden Treaty** (`@elysiajs/eden`) from `src/api.ts` for type-safe calls to Elysia routes. Export the server's `App` type and import it **type-only** in the frontend, so browser bundles never import server runtime code. The server currently imports the frontend package to serve its assets; keep that runtime dependency one-way.
- Use **TanStack Query** (`@tanstack/react-query`) for async server-state queries, mutations, invalidation, pending/error states, and refetching. Call the typed Eden client from query/mutation functions. React Router handles URL navigation; TanStack Query handles server state. Neither is the source of truth for draft revisions or conflict detection: the server must enforce those.

## Server (`packages/server`)

- Use **Elysia** for `/api/*`, **Drizzle + Postgres** for persistence, and **Better Auth** (`better-auth`) for staff passwords/sessions. Integrate Better Auth with Elysia and Drizzle when implementing sign-in. Gate registration behind the admin-issued, single-use invitation rule; Better Auth's generic sign-up endpoint must not bypass it. The current catch-all `/api/*` returns 404 and must be replaced/adjusted when adding auth routes.
- Use the **official MCP TypeScript SDK v2** (`@modelcontextprotocol/server`) for `/mcp/*` transport and tools. Authenticate with staff-bound keys before exposing content operations; MCP never manages accounts or invitations. The current `/mcp/*` response is an explicit 501 placeholder and must be replaced during implementation.

## Generator (`packages/generator`)

- Keep **PDFKit** (`pdfkit`) and the existing YAML CLI behavior. Adapt the generator to accept persisted bulletin data when implementing server-side preview/download; use its actual PDF bytes for both, not browser print.
