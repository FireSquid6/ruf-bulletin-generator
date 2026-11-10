import { count, eq, sql } from "drizzle-orm";
import { createAuth } from "./auth";
import type { Database } from "./db";
import { user } from "./schema";

export async function bootstrapAdmin(db: Database, credentials: { email: string; password: string; name: string }, config = {
  secret: process.env.BETTER_AUTH_SECRET ?? "",
  baseURL: process.env.APP_URL ?? "http://localhost:3000",
}) {
  if (!config.secret || credentials.password.length < 8) throw new Error("Configure BETTER_AUTH_SECRET and use a password of at least 8 characters");
  // The database's user table is the one-time authority; no setup token or public route survives bootstrap.
  return db.transaction(async (tx) => {
    // Serialize concurrent setup commands, including across server processes.
    await tx.execute(sql`select pg_advisory_xact_lock(72155103)`);
    const [existing] = await tx.select({ total: count() }).from(user);
    if (existing.total !== 0) throw new Error("An account already exists; bootstrap is disabled");
    const auth = createAuth(db, config);
    const created = await auth.api.signUpEmail({ body: credentials });
    await tx.update(user).set({ role: "admin" }).where(eq(user.id, created.user.id));
    return created.user.id;
  });
}

if (import.meta.main) {
  const { createDatabase } = await import("./db");
  const email = process.env.ADMIN_EMAIL;
  const name = process.env.ADMIN_NAME;
  const secret = process.env.BETTER_AUTH_SECRET;
  const databaseUrl = process.env.DATABASE_URL;
  if (!email || !name || !secret || !databaseUrl) throw new Error("Set ADMIN_EMAIL, ADMIN_NAME, BETTER_AUTH_SECRET and DATABASE_URL");
  const db = createDatabase(databaseUrl);
  try {
    // Password via a private environment variable; never print it.
    if (!process.env.ADMIN_PASSWORD) throw new Error("Set ADMIN_PASSWORD");
    await bootstrapAdmin(db.db, { email, name, password: process.env.ADMIN_PASSWORD });
    console.log("Initial administrator created");
  } finally {
    await db.close();
  }
}
