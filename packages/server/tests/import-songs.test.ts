import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { loadSongStore } from "@ruf/generator";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDatabase } from "../src/db";
import { importSongs } from "../src/import-songs";
import { song, user } from "../src/schema";

const source = resolve(import.meta.dir, "../../../store/song-store.yaml");

describe.skipIf(!process.env.TEST_DATABASE_URL)("legacy song import (disposable Postgres)", () => {
  test("imports the whole catalog for authenticated search, keeps order/defaults, and skips existing edits", async () => {
    const database = createDatabase(process.env.TEST_DATABASE_URL!);
    const original = readFileSync(source);
    const catalog = loadSongStore(source);
    const keys = Object.keys(catalog.songs);
    const email = `import-${crypto.randomUUID()}@example.org`;
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const inserted: string[] = [];
    try {
      // This is a fresh disposable test database; existing song keys must not be touched.
      expect(await database.db.select().from(song).where(eq(song.key, "his_glory_and_my_good"))).toEqual([]);
      await database.db.insert(song).values({ key: "his_glory_and_my_good", title: "Staff edit", parts: [{ text: "Edited lyrics" }] });
      inserted.push("his_glory_and_my_good");

      const first = await importSongs(database.db);
      inserted.push(...keys.filter(key => key !== "his_glory_and_my_good"));
      expect(first).toEqual({ imported: keys.length - 1, skipped: 1 });
      expect(await importSongs(database.db)).toEqual({ imported: 0, skipped: keys.length });
      expect(readFileSync(source)).toEqual(original);

      const [edited] = await database.db.select().from(song).where(eq(song.key, "his_glory_and_my_good"));
      expect(edited).toMatchObject({ title: "Staff edit", parts: [{ text: "Edited lyrics" }] });
      const [imported] = await database.db.select().from(song).where(eq(song.key, "example_song"));
      expect(imported).toMatchObject({ key: "example_song", title: catalog.songs.example_song.title,
        columns: catalog.songs.example_song.columns ?? null, scale: catalog.songs.example_song.scale ?? null });
      expect(imported.parts.map(part => [part.label, part.style, part.text]))
        .toEqual(catalog.songs.example_song.parts.map(part => [part.label, part.style, part.text]));
      const [chorus] = await database.db.select().from(song).where(eq(song.key, "his_mercy_is_more"));
      expect(chorus.columns).toBe(catalog.songs.his_mercy_is_more.columns!);
      expect(chorus.scale).toBe(catalog.songs.his_mercy_is_more.scale!);
      expect(chorus.parts.map(part => [part.label, part.style, part.text]))
        .toEqual(catalog.songs.his_mercy_is_more.parts.map(part => [part.label, part.style, part.text]));

      await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Importer", password: "test-password-123" } });
      const app = createApp(database.db, config);
      const login = await app.handle(new Request("http://localhost/api/auth/sign-in/email", {
        method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" },
        body: JSON.stringify({ email, password: "test-password-123" }),
      }));
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const result = await app.handle(new Request("http://localhost/api/songs?search=example_song", { headers: { cookie } }));
      expect(result.status).toBe(200);
      expect(await result.json()).toEqual({ songs: [imported] });
    } finally {
      for (const key of inserted) await database.db.delete(song).where(eq(song.key, key));
      await database.db.delete(user).where(eq(user.email, email));
      await database.close();
    }
  });
});
