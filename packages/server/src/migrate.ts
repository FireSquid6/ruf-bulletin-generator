import { Pool } from "pg";
import { readdir } from "node:fs/promises";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before migrating");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(72155104)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY)");
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort()) {
    const name = file.slice(0, -4);
    const result = await client.query("SELECT name FROM schema_migration WHERE name = $1", [name]);
    if (result.rowCount === 0) {
      await client.query(await Bun.file(new URL(file, directory)).text());
      if (name === "0004_assets") {
        const logo = Buffer.from(await Bun.file(new URL("../../../assets/ruf-baylor-logo.png", import.meta.url)).arrayBuffer());
        await client.query("INSERT INTO image_asset (id, name, kind, mime_type, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)",
          ["00000000-0000-4000-8000-000000000004", "RUF Baylor logo", "branding", "image/png", logo.length, logo]);
      }
      await client.query("INSERT INTO schema_migration (name) VALUES ($1)", [name]);
    }
  }
  await client.query("COMMIT");
  console.log("Database migrations applied");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
