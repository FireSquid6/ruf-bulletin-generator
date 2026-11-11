import { resolve } from "node:path";
import { loadSongStore } from "@ruf/generator";
import type { Database } from "./db";
import { song } from "./schema";

const defaultStore = resolve(import.meta.dir, "../../../store/song-store.yaml");

/** One-time, insert-only import. Existing keys (including staff edits) are never replaced. */
export async function importSongs(db: Database) {
  // Parse and validate the entire file before opening a write transaction.
  const store = loadSongStore(defaultStore);
  const entries = Object.entries(store.songs);
  const imported = await db.transaction(async (tx) => {
    let count = 0;
    for (const [key, entry] of entries) {
      const parts = entry.parts.map(part => ({
        text: part.text,
        ...(part.label === undefined ? {} : { label: part.label }),
        ...(part.style === "chorus" ? { style: "chorus" as const } : {}),
      }));
      const rows = await tx.insert(song).values({ key, title: entry.title, parts,
        columns: entry.columns ?? null, scale: entry.scale ?? null })
        .onConflictDoNothing({ target: song.key }).returning({ key: song.key });
      count += rows.length;
    }
    return count;
  });
  return { imported, skipped: entries.length - imported };
}

if (import.meta.main) {
  const { createDatabase } = await import("./db");
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a migrated Postgres database");
  const database = createDatabase(process.env.DATABASE_URL);
  try {
    const result = await importSongs(database.db);
    console.log(`Song store import: ${result.imported} inserted, ${result.skipped} existing keys skipped`);
  } finally {
    await database.close();
  }
}
