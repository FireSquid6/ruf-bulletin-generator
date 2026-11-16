import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "./db";
import * as schema from "./schema";
import { configuredMailer, type Mailer } from "./email";

export type AuthConfig = { secret: string; baseURL: string; emailConfirmation?: boolean; mailer?: Mailer };

export function createAuth(db: Database, config: AuthConfig) {
  const send = (to: string, subject: string, url: string) =>
    (config.mailer ?? configuredMailer()).send({ to, subject, text: `Open this link to ${subject.toLowerCase()}: ${url}\n\nIf you did not request this, you can ignore this email.` });
  return betterAuth({
    database: drizzleAdapter(db, { provider: "pg", schema, transaction: true }),
    secret: config.secret,
    baseURL: config.baseURL,
    basePath: "/api/auth",
    trustedOrigins: [config.baseURL],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: config.emailConfirmation === true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => send(user.email, "Reset your password", url),
    },
    ...(config.emailConfirmation ? { emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }: { user: { email: string }; url: string }) => send(user.email, "Confirm your email address", url),
    } } : {}),
    user: { additionalFields: { role: { type: "string", required: false, input: false, defaultValue: "staff" } } },
  });
}
