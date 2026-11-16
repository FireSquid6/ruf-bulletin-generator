import { createApp } from "./app";
import { createDatabase } from "./db";
import { configuredMailer } from "./email";

const port = Number(process.env.PORT ?? 3000);
if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET || !process.env.APP_URL) {
  throw new Error("Set DATABASE_URL, BETTER_AUTH_SECRET and APP_URL before starting the server");
}
const database = createDatabase(process.env.DATABASE_URL);
if (process.env.EMAIL_CONFIRMATION !== undefined && !["true", "false"].includes(process.env.EMAIL_CONFIRMATION)) throw new Error("EMAIL_CONFIRMATION must be true or false");
const emailConfirmation = process.env.EMAIL_CONFIRMATION === "true";
createApp(database.db, { secret: process.env.BETTER_AUTH_SECRET, baseURL: process.env.APP_URL, emailConfirmation, mailer: configuredMailer() }).listen(port);
console.log(`RUF Bulletin Studio listening on http://localhost:${port}`);
