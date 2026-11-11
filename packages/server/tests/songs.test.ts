import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { createDatabase } from "../src/db";
import { bulletin, song, user } from "../src/schema";
import { eq } from "drizzle-orm";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("song store over authenticated HTTP (Postgres)", () => {
  test("a draft keeps only a song key while store edits, renames, deletion and key reuse change resolution", async () => {
    const database = createDatabase(url!);
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const app = createApp(database.db, config);
    const email = `song-draft-${crypto.randomUUID()}@example.org`;
    const key = `hymn-${crypto.randomUUID()}`;
    const renamed = `${key}-renamed`;
    const gatheringDate = `20${String(Math.floor(Math.random() * 50) + 50)}-01-13`;
    let draftId: string | undefined;
    let cookie = "";
    const call = (path: string, method = "GET", body?: unknown) => app.handle(new Request(`http://localhost${path}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json", origin: "http://localhost" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const songAt = async (songKey: string) => {
      const response = await call(`/api/songs/${encodeURIComponent(songKey)}`);
      return response.status === 404 ? null : (await response.json()).song;
    };
    try {
      await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Song tester", password: "test-password-123" } });
      const login = await call("/api/auth/sign-in/email", "POST", { email, password: "test-password-123" });
      cookie = login.headers.get("set-cookie")!.split(";")[0];
      const first = { key, title: "First title", parts: [{ text: "First lyrics" }] };
      expect((await call("/api/songs", "POST", first)).status).toBe(201);
      const created = await (await call("/api/bulletins", "POST", { gatheringDate })).json();
      draftId = created.id;
      const composition = { cover: [], flow: [{ type: "song", songKey: key }] };
      expect((await call(`/api/bulletins/${draftId}`, "PUT", { gatheringDate, revision: 1, composition: { cover: [], flow: [{ ...composition.flow[0], parts: first.parts }] } })).status).toBe(400);
      const saved = await call(`/api/bulletins/${draftId}`, "PUT", { gatheringDate, revision: 1, composition });
      expect(saved.status).toBe(200);
      expect((await saved.json()).composition).toEqual(composition);
      expect((await songAt(key)).parts).toEqual(first.parts);
      expect((await call(`/api/songs/${encodeURIComponent(key)}`, "PUT", { ...first, title: "Edited title", parts: [{ text: "New lyrics" }] })).status).toBe(200);
      expect((await songAt(key)).parts).toEqual([{ text: "New lyrics" }]);
      expect((await call(`/api/songs/${encodeURIComponent(key)}`, "PUT", { ...first, key: renamed })).status).toBe(200);
      expect(await songAt(key)).toBeNull();
      expect((await call(`/api/songs/${encodeURIComponent(renamed)}`, "DELETE")).status).toBe(200);
      expect(await songAt(renamed)).toBeNull();
      expect((await call("/api/songs", "POST", { ...first, title: "Reconnected", parts: [{ text: "Reused key lyrics" }] })).status).toBe(201);
      expect((await songAt(key)).title).toBe("Reconnected");
      expect((await call(`/api/songs/${encodeURIComponent(key)}`, "DELETE")).status).toBe(200);
      expect(await songAt(key)).toBeNull();
      expect((await call("/api/songs", "POST", { ...first, title: "Reconnected again" })).status).toBe(201);
      expect((await songAt(key)).title).toBe("Reconnected again");
      const reopened = await (await call(`/api/bulletins/${draftId}`)).json();
      expect(reopened.revision).toBe(2);
      expect(reopened.composition).toEqual(composition);
      expect(JSON.stringify(reopened.composition)).not.toContain("lyrics");
    } finally {
      if (draftId) await call(`/api/bulletins/${draftId}`, "DELETE");
      await database.db.delete(song).where(eq(song.key, key));
      await database.db.delete(song).where(eq(song.key, renamed));
      await database.db.delete(user).where(eq(user.email, email));
      await database.close();
    }
  });
  test("search, ordered parts, defaults, unique keys, rename and delete leave draft references untouched", async () => {
    const database = createDatabase(url!);
    const config = { secret: "test-secret-at-least-thirty-two-characters", baseURL: "http://localhost" };
    const app = createApp(database.db, config);
    const email = `song-${crypto.randomUUID()}@example.org`;
    const key = `song-${crypto.randomUUID()}`;
    const renamed = `${key}-new`;
    const draftId = crypto.randomUUID();
    let userId: string | undefined;
    const call = (path: string, method = "GET", body?: unknown, cookie?: string) => app.handle(new Request(`http://localhost${path}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { "content-type": "application/json", origin: "http://localhost" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    try {
      expect((await call("/api/songs")).status).toBe(401);
      expect((await call("/api/songs", "POST", { key, title: "Test", parts: [] })).status).toBe(401);
      userId = (await createAuth(database.db, config).api.signUpEmail({ body: { email, name: "Song tester", password: "test-password-123" } })).user.id;
      const login = await call("/api/auth/sign-in/email", "POST", { email, password: "test-password-123" });
      const cookie = login.headers.get("set-cookie")!.split(";")[0];
      const initial = { key, title: "A New Hymn", parts: [{ label: "Verse 1", text: "First line" }, { label: "Chorus", style: "chorus", text: "Refrain" }], columns: 2, scale: 0.9 };
      expect((await call("/api/songs", "POST", { ...initial, parts: [] }, cookie)).status).toBe(422);
      expect((await call("/api/songs", "POST", { ...initial, columns: 3 }, cookie)).status).toBe(422);
      const created = await call("/api/songs", "POST", initial, cookie);
      expect(created.status).toBe(201);
      expect(await created.json()).toEqual({ song: initial });
      expect((await call("/api/songs", "POST", initial, cookie)).status).toBe(409);
      expect(await (await call(`/api/songs?search=${encodeURIComponent("new hymn")}`, "GET", undefined, cookie)).json()).toEqual({ songs: [initial] });
      expect(await (await call(`/api/songs?search=${encodeURIComponent(key)}`, "GET", undefined, cookie)).json()).toEqual({ songs: [initial] });
      expect(await (await call("/api/songs?search=unrelated", "GET", undefined, cookie)).json()).toEqual({ songs: [] });
      const composition = JSON.stringify([{ type: "song", songKey: key }]);
      await database.db.insert(bulletin).values({ id: draftId, gatheringDate: "2099-01-01", composition });
      const updated = { key: renamed, title: "Renamed", parts: [initial.parts[1], initial.parts[0]], columns: null, scale: null };
      expect(await (await call(`/api/songs/${encodeURIComponent(key)}`, "PUT", updated, cookie)).json()).toEqual({ song: { key: renamed, title: "Renamed", parts: updated.parts, columns: null, scale: null } });
      expect((await call(`/api/songs/${encodeURIComponent(key)}`, "GET", undefined, cookie)).status).toBe(404);
      expect(await (await call(`/api/songs/${encodeURIComponent(renamed)}`, "GET", undefined, cookie)).json()).toEqual({ song: { ...updated } });
      expect((await call("/api/songs", "POST", initial, cookie)).status).toBe(201);
      expect((await call(`/api/songs/${encodeURIComponent(renamed)}`, "PUT", { ...updated, key }, cookie)).status).toBe(409);
      expect((await call(`/api/songs/missing-${key}`, "PUT", updated, cookie)).status).toBe(404);
      expect((await call(`/api/songs/${encodeURIComponent(renamed)}`, "DELETE", undefined, cookie)).status).toBe(200);
      expect((await call(`/api/songs/${encodeURIComponent(renamed)}`, "GET", undefined, cookie)).status).toBe(404);
      expect((await call(`/api/songs/${encodeURIComponent(renamed)}`, "DELETE", undefined, cookie)).status).toBe(404);
      const [draft] = await database.db.select().from(bulletin).where(eq(bulletin.id, draftId));
      expect(draft.composition).toBe(composition);
      expect((await call("/api/songs", "POST", initial, cookie)).status).toBe(409);
      expect((await call(`/api/songs/${encodeURIComponent(key)}`, "DELETE", undefined, cookie)).status).toBe(200);
      expect((await call("/api/songs", "POST", initial, cookie)).status).toBe(201);
      expect((await call(`/api/songs/${encodeURIComponent(key)}`, "DELETE", undefined, cookie)).status).toBe(200);
    } finally {
      await database.db.delete(bulletin).where(eq(bulletin.id, draftId));
      await database.db.delete(song).where(eq(song.key, key));
      await database.db.delete(song).where(eq(song.key, renamed));
      await database.db.delete(user).where(eq(user.email, email));
      await database.close();
    }
  });
});
