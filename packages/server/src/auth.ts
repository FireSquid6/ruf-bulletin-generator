import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db";
import * as schema from "./schema";

export function createAuth(db: Database, config: { secret: string; baseURL: string }) {
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema }),
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [config.baseURL],
    emailAndPassword: { enabled: true },
    user: { additionalFields: { role: { type: "string", required: false, input: false, defaultValue: "staff" } } },
  });
}
