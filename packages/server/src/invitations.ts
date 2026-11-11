import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { Elysia } from "elysia";
import type { Database } from "./db";
import type { createAuth } from "./auth";
import { invitation, user } from "./schema";

const keyPattern = /^[A-Za-z0-9_-]{16}$/;
const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export function invitationRoutes(db: Database, auth: ReturnType<typeof createAuth>, origin: string) {
  return new Elysia()
    .get("/api/invitations", async ({ request, set }) => {
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) { set.status = 401; return { error: "Sign in required" }; }
      if (session.user.role !== "admin") { set.status = 403; return { error: "Administrator access required" }; }
      const rows = await db.select({ id: invitation.id, createdAt: invitation.createdAt, consumedAt: invitation.consumedAt }).from(invitation).orderBy(invitation.createdAt);
      return { invitations: rows };
    })
    .post("/api/invitations", async ({ request, set }) => {
      if (request.headers.get("origin") !== origin) { set.status = 403; return { error: "Invalid request origin" }; }
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) { set.status = 401; return { error: "Sign in required" }; }
      if (session.user.role !== "admin") { set.status = 403; return { error: "Administrator access required" }; }
      // Twelve bytes encode to exactly sixteen base64url characters (96 bits).
      const key = randomBytes(12).toString("base64url");
      await db.insert(invitation).values({ id: randomUUID(), keyHash: hash(key), issuedBy: session.user.id });
      set.status = 201;
      set.headers["cache-control"] = "no-store";
      return { key };
    })
    .post("/api/register", async ({ request, body, set }) => {
      if (request.headers.get("origin") !== origin) { set.status = 403; return { error: "Invalid request origin" }; }
      const values = body && typeof body === "object" ? body as Record<string, unknown> : {};
      const { email, password, invitationKey } = values;
      if (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== "string" || password.length < 8 || typeof invitationKey !== "string" || !keyPattern.test(invitationKey)) {
        set.status = 400;
        return { error: "Enter a valid email, password of at least 8 characters, and 16-character invitation key." };
      }
      try {
        const created = await db.transaction(async tx => {
          // An UPDATE locks the row until commit. Concurrent redemptions wait, then
          // see the consumed key. Rollback on signup failure keeps the key usable.
          const [claimed] = await tx.update(invitation).set({ consumedAt: new Date() })
            .where(and(eq(invitation.keyHash, hash(invitationKey)), isNull(invitation.consumedAt)))
            .returning({ id: invitation.id });
          if (!claimed) return false;
          // Better Auth intentionally returns a synthetic success for duplicate
          // emails when verification is required. Never spend an invitation on it.
          const [existing] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email.toLowerCase()));
          if (existing) throw new Error("Account already exists");
          const account = await auth.api.signUpEmail({ body: { email, password, name: email } });
          const [persisted] = await tx.select({ id: user.id }).from(user).where(eq(user.id, account.user.id));
          if (!persisted) throw new Error("Account already exists");
          await tx.update(invitation).set({ consumedBy: account.user.id }).where(eq(invitation.id, claimed.id));
          return true;
        });
        if (!created) { set.status = 400; return { error: "Invitation key is invalid or has already been used." }; }
        set.status = 201;
        return { registered: true };
      } catch (error) {
        // Better Auth rejects duplicate emails/invalid credentials. Don't consume
        // the invitation or reveal whether the email already has an account.
        if ((error instanceof Error && error.message === "Account already exists") || (error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 500)) {
          set.status = 400;
          return { error: "Could not register with these details. Check your email and password." };
        }
        throw error;
      }
    });
}
