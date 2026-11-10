import { Pool } from "pg";

if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before migrating");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(72155104)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY)");
  for (const name of ["0001_workspace", "0002_drafts"]) {
    const result = await client.query("SELECT name FROM schema_migration WHERE name = $1", [name]);
    if (result.rowCount === 0) {
      await client.query(await Bun.file(new URL(`../migrations/${name}.sql`, import.meta.url)).text());
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
