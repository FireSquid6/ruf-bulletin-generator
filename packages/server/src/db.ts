import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Connection is lazy so the HTTP shell can start before database provisioning.
// All future application queries should use this Drizzle instance.
export function createDatabase(connectionString: string) {
  const pool = new Pool({ connectionString });
  return { db: drizzle(pool), close: () => pool.end() };
}
