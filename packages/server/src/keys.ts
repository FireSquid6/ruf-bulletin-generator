import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Database } from "./db";
import type { createAuth } from "./auth";
import { mcpKey, user } from "./schema";

const digest = (secret: string) => createHash("sha256").update(secret).digest("hex");

export async function authenticateMcpKey(db: Database, authorization: string | null) {
  if (!authorization?.startsWith("Bearer ")) return null;
  const secret = authorization.slice(7);
  if (!/^ruf_mcp_[A-Za-z0-9_-]{43}$/.test(secret)) return null;
  const [identity] = await db.select({ id: user.id, name: user.name, email: user.email })
    .from(mcpKey).innerJoin(user, eq(mcpKey.userId, user.id))
    .where(and(eq(mcpKey.secretHash, digest(secret)), isNull(mcpKey.revokedAt)));
  // Intentionally no role or session: an MCP credential cannot carry admin authority.
  return identity ?? null;
}

export function keyRoutes(db: Database, auth: ReturnType<typeof createAuth>) {
  type RouteSet = { status?: number | string; headers: { [key: string]: string | number | undefined } };
  const admin = async (headers: Headers) => {
    const session = await auth.api.getSession({ headers });
    if (!session) return 401 as const;
    const [account] = await db.select({ role: user.role }).from(user).where(eq(user.id, session.user.id));
    return account?.role === "admin" ? null : 403 as const;
  };
  const denied = (status: 401 | 403, set: RouteSet) => {
    set.status = status;
    return { error: status === 401 ? "Sign in required" : "Administrator access required" };
  };
  return {
    staff: async (headers: Headers, set: RouteSet) => {
      const status = await admin(headers);
      if (status) return denied(status, set);
      return { staff: await db.select({ id: user.id, name: user.name, email: user.email }).from(user).orderBy(user.name) };
    },
    list: async (headers: Headers, set: RouteSet) => {
      set.headers["cache-control"] = "no-store";
      const status = await admin(headers);
      if (status) return denied(status, set);
      const keys = await db.select({ id: mcpKey.id, label: mcpKey.label, userId: user.id, userName: user.name, userEmail: user.email, createdAt: mcpKey.createdAt, revokedAt: mcpKey.revokedAt })
        .from(mcpKey).innerJoin(user, eq(mcpKey.userId, user.id)).orderBy(mcpKey.createdAt);
      return { keys };
    },
    issue: async (headers: Headers, body: { userId?: string; label?: string }, set: RouteSet, origin: string) => {
      set.headers["cache-control"] = "no-store";
      const status = await admin(headers);
      if (status) return denied(status, set);
      if (headers.get("origin") !== origin) { set.status = 403; return { error: "Invalid request origin" }; }
      const label = typeof body?.label === "string" ? body.label.trim() : "";
      if (!label || label.length > 100 || typeof body?.userId !== "string") {
        set.status = 400;
        return { error: "Choose a staff account and enter a key name (1–100 characters)." };
      }
      const [account] = await db.select({ id: user.id }).from(user).where(eq(user.id, body.userId));
      if (!account) { set.status = 400; return { error: "Staff account not found." }; }
      const secret = `ruf_mcp_${randomBytes(32).toString("base64url")}`;
      const [key] = await db.insert(mcpKey).values({ id: randomUUID(), userId: account.id, label, secretHash: digest(secret) })
        .returning({ id: mcpKey.id, label: mcpKey.label, userId: mcpKey.userId, createdAt: mcpKey.createdAt, revokedAt: mcpKey.revokedAt });
      set.status = 201;
      return { key, secret };
    },
    revoke: async (headers: Headers, id: string, set: RouteSet, origin: string) => {
      set.headers["cache-control"] = "no-store";
      const status = await admin(headers);
      if (status) return denied(status, set);
      if (headers.get("origin") !== origin) { set.status = 403; return { error: "Invalid request origin" }; }
      const [key] = await db.update(mcpKey).set({ revokedAt: new Date() }).where(and(eq(mcpKey.id, id), isNull(mcpKey.revokedAt))).returning({ id: mcpKey.id });
      if (!key) { set.status = 404; return { error: "Active key not found." }; }
      return { revoked: true };
    },
  };
}
