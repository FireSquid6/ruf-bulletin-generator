import { createApp } from "./app";
import { createDatabase } from "./db";

const port = Number(process.env.PORT ?? 3000);
if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET || !process.env.APP_URL) {
  throw new Error("Set DATABASE_URL, BETTER_AUTH_SECRET and APP_URL before starting the server");
}
const database = createDatabase(process.env.DATABASE_URL);
createApp(database.db, { secret: process.env.BETTER_AUTH_SECRET, baseURL: process.env.APP_URL }).listen(port);
console.log(`RUF Bulletin Studio listening on http://localhost:${port}`);
