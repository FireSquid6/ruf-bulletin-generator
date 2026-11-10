import { existsSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(import.meta.dirname, "../../dist");

// The server imports this module, not the browser-only React entry point.
export function frontendResponse(pathname: string): Response {
  const requestPath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const candidate = path.resolve(dist, requestPath);
  if (candidate !== dist && !candidate.startsWith(`${dist}${path.sep}`)) {
    return new Response("Not found", { status: 404 });
  }

  // Only use the SPA fallback for extensionless navigation, not missing JS/CSS files.
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : path.extname(requestPath) ? null : path.join(dist, "index.html");
  if (!file) return new Response("Not found", { status: 404 });
  if (!existsSync(file)) {
    return new Response("Frontend not built. Run `bun run build` first.", { status: 503 });
  }
  return new Response(Bun.file(file));
}
