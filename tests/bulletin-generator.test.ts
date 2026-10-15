import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import YAML from "js-yaml";
import {
  arrangeFoldedPages,
  generate,
  planFoldedFlow,
  resolveSongReferences,
  loadSongStore,
  type SongStore,
  validateSongStore,
  validateSpec,
} from "../src";

const EXAMPLE_YAML = path.resolve(import.meta.dirname, "../example/example-dummy.yaml");

function writeSpec(dir: string, specText: string): string {
  const filePath = path.join(dir, "spec.yaml");
  fs.writeFileSync(filePath, specText, "utf-8");
  return filePath;
}

function writeStore(dir: string, storeText: string): string {
  const filePath = path.join(dir, "song-store.yaml");
  fs.writeFileSync(filePath, storeText, "utf-8");
  return filePath;
}

describe("generate", () => {
  test("rejects a non-mapping root", () => {
    expect(() => validateSpec("just a string")).toThrow();
    expect(() => validateSpec(42)).toThrow();
  });

  test("rejects missing or out-of-range pages", () => {
    expect(() => validateSpec({})).toThrow();
    expect(() => validateSpec({ pages: [] })).toThrow();
    expect(() =>
      validateSpec({ pages: [{ columns: [[]] }, { columns: [[]] }, { columns: [[]] }] }),
    ).toThrow();
  });

  test("rejects a page without columns", () => {
    expect(() => validateSpec({ pages: [{}] })).toThrow();
    expect(() => validateSpec({ pages: [{ columns: [] }] })).toThrow();
  });

  test("rejects more than three columns per page", () => {
    expect(() => validateSpec({ pages: [{ columns: [[], [], [], []] }] })).toThrow();
  });

  test("rejects unknown block types", () => {
    expect(() => validateSpec({ pages: [{ columns: [[{ type: "nonsense" }]] }] })).toThrow();
  });

  test("accepts a minimal valid spec", () => {
    expect(() => validateSpec({ pages: [{ columns: [[{ type: "text", text: "hi" }]] }] })).not.toThrow();
  });

  test("accepts cover and flow without manual pages", () => {
    expect(() => validateSpec({
      cover: [{ type: "text", text: "cover" }],
      flow: [{ type: "text", text: "content" }],
    })).not.toThrow();
  });

  test("requires a complete, unambiguous folded layout", () => {
    expect(() => validateSpec({ cover: [], flow: [], pages: [{ columns: [[]] }] })).toThrow();
    expect(() => validateSpec({ cover: [] })).toThrow();
    expect(() => validateSpec({
      folded: true,
      pages: [{ columns: [[], []] }],
    })).toThrow("exactly two pages");
  });
});

describe("song store", () => {
  test("covers existing weekly songs with numbered verses and unnumbered choruses", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const store = loadSongStore(path.join(root, "store/song-store.yaml"));
    const referenced = new Set<string>();

    for (const file of fs.readdirSync(path.join(root, "bulletins")).filter((name) => name.endsWith(".yaml") && name <= "2026-10-07.yaml")) {
      const spec = YAML.load(fs.readFileSync(path.join(root, "bulletins", file), "utf8"));
      validateSpec(spec);
      const resolved = resolveSongReferences(spec, store);
      const blocks = resolved.pages!.flatMap((page) => page.columns.flat());
      const originals = (spec as typeof resolved).pages!.flatMap((page) => page.columns.flat());
      for (const block of originals.filter((item) => item.type === "song")) {
        expect(typeof block.song_ref, file).toBe("string");
        expect(block.title, file).toBeUndefined();
        expect(block.parts, file).toBeUndefined();
        referenced.add(block.song_ref as string);
      }
      expect(blocks.filter((block) => block.type === "song").length).toBe(4);
    }

    expect(referenced.size).toBe(23);
    for (const key of referenced) expect(store.songs[key], key).toBeDefined();
    for (const key of ["sweet_comfort", "yet_not_i_but_through_christ_in_me"]) {
      expect(store.songs[key].parts).toHaveLength(4);
      expect(store.songs[key].parts.every((part) => part.style === undefined)).toBe(true);
    }
    for (const [key, song] of Object.entries(store.songs)) {
      let verse = 0;
      for (const part of song.parts) {
        if (part.style === "chorus") expect(part.label, key).toBeUndefined();
        else if (part.label === "Bridge") continue;
        else expect(part.label, key).toBe(`${++verse}.`);
      }
    }
  });

  test("future bulletins follow the worship plan, with missing songs left as references", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const store = loadSongStore(path.join(root, "store/song-store.yaml"));
    const notInSheet = new Set(["here_is_love", "be_unto_your_name"]);
    const weeks = [
      ["2026-10-14", "James 4:1-10", "Proverbs 4:23-27", "it_is_well", "on_jordan_s_stormy_banks", "your_will_be_done", "this_is_my_father_s_world"],
      ["2026-10-21", "James 4:11-17", "Jeremiah 9:23-24", "how_deep_the_father_s_love", "his_mercy_is_more", "sweet_comfort", "yet_not_i_but_through_christ_in_me"],
      ["2026-10-28", "James 5:1-6", "1 Timothy 6:6-10", "he_will_hold_me_fast", "great_is_thy_faithfulness", "in_christ_alone", "hast_thou_heard_him"],
      ["2026-11-04", "James 5:7-12", "Psalm 37:7-9", "come_behold_the_wondrous_mystery", "o_love_that_will_not_let_me_go", "a_christian_s_daily_prayer", "all_praise_to_him"],
      ["2026-11-11", "James 5:13-20", "1 Kings 17:17-24", "goodness_of_jesus", "on_jordan_s_stormy_banks", "here_is_love", "jesus_paid_it_all"],
      ["2026-11-18", "Jude 1-25", "2 Peter 1:3-8", "we_will_feast_in_the_house_of_zion", "be_unto_your_name", "sweet_comfort", "arise_my_soul_arise"],
    ];

    for (const [date, sermon, reading, ...songs] of weeks) {
      const spec = YAML.load(fs.readFileSync(path.join(root, "bulletins", `${date}.yaml`), "utf8"));
      validateSpec(spec);
      const blocks = spec.pages!.flatMap((page) => page.columns.flat());
      const scriptures = blocks.filter((block) => block.type === "scripture");
      expect(scriptures.map((block) => block.reference)).toEqual([sermon, reading]);
      for (const scripture of scriptures) {
        expect(typeof scripture.text).toBe("string");
        expect((scripture.text as string).match(/\(\d+\) /g)?.length).toBeGreaterThan(0);
      }
      expect(((scriptures[1].text as string).match(/\(\d+\) /g) ?? []).length).toBeLessThanOrEqual(15);
      expect(blocks.filter((block) => block.type === "song").map((block) => block.song_ref)).toEqual(songs);
      for (const key of songs) {
        expect(Object.hasOwn(store.songs, key), key).toBe(!notInSheet.has(key));
      }
      for (const song of blocks.filter((block) => block.type === "song" && Object.hasOwn(store.songs, block.song_ref as string))) {
        expect(resolveSongReferences({ pages: [{ columns: [[song]] }] }, store).pages![0].columns[0][0].title)
          .toBe(store.songs[song.song_ref as string].title);
      }
    }
  });

  test("imports the distinct songs from the song sheet without replacing weekly entries", () => {
    const store = loadSongStore(path.resolve(import.meta.dirname, "../store/song-store.yaml"));
    expect(Object.keys(store.songs)).toHaveLength(83);
    for (const key of [
      "build_my_life", "praise_to_the_lord_joyful_joyful", "he_will_hold_me_fast",
      "in_christ_alone", "your_will_be_done", "o_come_to_the_alter",
      "a_christian_s_daily_prayer", "i_am_not_my_own", "servant_king", "speak_o_lord",
    ]) expect(store.songs[key], key).toBeDefined();
  });

  const store: SongStore = {
    songs: {
      test_song: {
        title: "Stored Song",
        columns: 2,
        scale: 0.9,
        parts: [{ text: "Stored lyrics" }],
      },
    },
  };

  test("validates stored song content", () => {
    expect(() => validateSongStore(store)).not.toThrow();
    expect(() => validateSongStore({ songs: { broken: { title: "Broken", parts: [] } } }))
      .toThrow("non-empty parts list");
    expect(() => validateSongStore({
      songs: { broken: { title: "Broken", parts: [{ text: "Hi", style: "loud" }] } },
    })).toThrow("unsupported style");
  });

  test("resolves references in folded flow and legacy pages", () => {
    const folded = resolveSongReferences({
      cover: [{ type: "song", song_ref: "test_song", columns: 1 }],
      flow: [{ type: "song", song_ref: "test_song" }],
    }, store);
    const legacy = resolveSongReferences({
      pages: [{ columns: [[{ type: "song", song_ref: "test_song", scale: 0.75 }]] }],
    }, store);

    expect(folded.cover?.[0]).toEqual({
      type: "song",
      title: "Stored Song",
      parts: [{ text: "Stored lyrics" }],
      columns: 1,
      scale: 0.9,
    });
    expect(folded.flow?.[0].columns).toBe(2);
    expect(legacy.pages?.[0].columns[0][0].scale).toBe(0.75);
  });

  test("rejects missing and ambiguous song references with their location", () => {
    expect(() => resolveSongReferences({
      flow: [{ type: "song", song_ref: "missing" }],
      cover: [],
    }, store)).toThrow("Song 'missing' referenced by Flow block 1 was not found");
    expect(() => resolveSongReferences({
      flow: [{ type: "song", song_ref: "toString" }],
      cover: [],
    }, store)).toThrow("Song 'toString' referenced by Flow block 1 was not found");
    expect(() => resolveSongReferences({
      pages: [{ columns: [[{ type: "song", song_ref: "test_song", title: "Override" }]] }],
    }, store)).toThrow("Page 1, column 1 block 1 cannot combine song_ref with title or parts");
  });
});

describe("folded flow", () => {
  test("places panels in folded reading order with the cover at page one right", () => {
    const first = { type: "text", text: "first" };
    const second = { type: "text", text: "second" };
    const last = { type: "text", text: "last" };
    const cover = [{ type: "text", text: "cover" }];
    const pages = arrangeFoldedPages(cover, [[first], [second], [last]]);

    expect(pages).toEqual([[[last], cover], [[first], [second]]]);
  });

  test("flows whole blocks in order and maximizes a common scale", () => {
    const blocks = Array.from({ length: 5 }, (_, index) => ({
      type: "spacer",
      height_mm: 30,
      id: index,
    }));
    const plan = planFoldedFlow([], blocks, 0, 0, 200, 180, import.meta.dirname);

    expect(plan.scale).toBe(4);
    expect(plan.columns.map((column) => column.map((block) => block.id))).toEqual([
      [0, 1],
      [2, 3],
      [4],
    ]);
  });

  test("grows text beyond its base size when the panels have room", () => {
    const plan = planFoldedFlow(
      [{ type: "text", text: "Readable body text ".repeat(10) }],
      [],
      0,
      0,
      200,
      300,
      import.meta.dirname,
    );

    expect(plan.scale).toBeGreaterThan(1);
  });

  test("rejects content that overflows even at the minimum scale", () => {
    expect(() => planFoldedFlow(
      [],
      [{ type: "spacer", height_mm: 100 }],
      0,
      0,
      200,
      100,
      import.meta.dirname,
    )).toThrow("minimum font scale");
  });
});

describe("generate", () => {
  test("produces a one-page A4 landscape sheet for a minimal spec", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: text",
        "          text: Hello bulletin",
        "",
      ].join("\n"),
    );
    const out = path.join(dir, "out.pdf");
    const destination = await generate(spec, out);
    expect(fs.existsSync(destination)).toBe(true);

    const bytes = fs.readFileSync(destination);
    const trailer = bytes.subarray(-2048).toString("latin1");
    expect(trailer).toContain("/Type /Catalog");
    // A4 landscape MediaBox
    expect(trailer).toContain("841.89");
    expect(trailer).toContain("595.28");
  });

  test("the example YAML renders both sides with expected content", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const out = path.join(dir, "example.pdf");
    const destination = await generate(EXAMPLE_YAML, out);
    expect(fs.existsSync(destination)).toBe(true);

    const bytes = fs.readFileSync(destination);
    expect(bytes.length).toBeGreaterThan(10_000); // logo + QR embedded
    // Two content sides
    expect(bytes.toString("latin1").match(/\/Type \/Page[^s]/g)?.length).toBe(2);
  });

  test("renders the direct cover and flow format as two physical sides", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "cover:",
        "  - type: heading",
        "    text: Cover",
        "flow:",
        "  - type: text",
        "    text: Flowing content",
        "",
      ].join("\n"),
    );
    const destination = await generate(spec, path.join(dir, "out.pdf"));
    const bytes = fs.readFileSync(destination);

    expect(bytes.toString("latin1").match(/\/Type \/Page[^s]/g)?.length).toBe(2);
  });

  test("renders a song from an explicit store", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: song",
        "          song_ref: stored_song",
        "          columns: 1",
        "",
      ].join("\n"),
    );
    const storePath = writeStore(
      dir,
      [
        "songs:",
        "  stored_song:",
        "    title: Stored Song",
        "    columns: 2",
        "    parts:",
        "      - text: Stored lyrics",
        "",
      ].join("\n"),
    );

    const destination = await generate(spec, path.join(dir, "out.pdf"), false, storePath);
    expect(fs.existsSync(destination)).toBe(true);
  });

  test("uses the default store for song references", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: song",
        "          song_ref: example_song",
        "",
      ].join("\n"),
    );

    const destination = await generate(spec, path.join(dir, "out.pdf"));
    expect(fs.existsSync(destination)).toBe(true);
  });

  test("reports missing stores and songs before rendering", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: song",
        "          song_ref: absent",
        "",
      ].join("\n"),
    );
    const storePath = writeStore(dir, "songs: {}\n");

    await expect(generate(spec, path.join(dir, "out.pdf"), false, storePath))
      .rejects.toThrow("Song 'absent'");
    await expect(generate(spec, path.join(dir, "out.pdf"), false, path.join(dir, "missing.yaml")))
      .rejects.toThrow("Unable to read song store");
  });

  test("forwards --store through the CLI", () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: song",
        "          song_ref: cli_song",
        "",
      ].join("\n"),
    );
    const storePath = writeStore(
      dir,
      [
        "songs:",
        "  cli_song:",
        "    title: CLI Song",
        "    parts:",
        "      - text: CLI lyrics",
        "",
      ].join("\n"),
    );
    const out = path.join(dir, "cli.pdf");
    const result = Bun.spawnSync([
      process.execPath,
      "run",
      path.resolve(import.meta.dirname, "../src/cli.ts"),
      spec,
      "--output",
      out,
      "--store",
      storePath,
    ]);

    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(fs.existsSync(out)).toBe(true);
  });

  test("renders multiple QR codes in one row", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: qr",
        "          items:",
        "            - caption: GroupMe",
        `              path: ${path.resolve(import.meta.dirname, "../assets/groupme-qr.png")}`,
        "            - caption: Prayer Requests",
        `              path: ${path.resolve(import.meta.dirname, "../assets/prayer-group-qr.png")}`,
        "",
      ].join("\n"),
    );
    const destination = await generate(spec, path.join(dir, "out.pdf"));
    expect(fs.existsSync(destination)).toBe(true);
    expect(fs.readFileSync(destination).length).toBeGreaterThan(5_000);
  });

  test("rejects a song without a title or parts", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: song",
        "          parts:",
        "            - text: hi",
        "",
      ].join("\n"),
    );
    await expect(generate(spec, path.join(dir, "out.pdf"))).rejects.toThrow();
  });

  test("rejects a non-positive song scale", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: song",
        "          title: Test Song",
        "          scale: 0",
        "          parts:",
        "            - text: Test verse",
        "",
      ].join("\n"),
    );
    await expect(generate(spec, path.join(dir, "out.pdf"))).rejects.toThrow("scale must be a positive number");
  });

  test("rejects column_weights that do not match columns", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    const spec = writeSpec(
      dir,
      [
        "pages:",
        "  - columns:",
        "      - - type: text",
        "          text: left",
        "      - - type: text",
        "          text: right",
        "    column_weights: [2]",
        "",
      ].join("\n"),
    );
    await expect(generate(spec, path.join(dir, "out.pdf"))).rejects.toThrow();
  });

  test("resolves output relative to the YAML file", async () => {
    const dir = fs.mkdtempSync("/tmp/ruf-test-");
    fs.mkdirSync(path.join(dir, "nested"), { recursive: true });
    const spec = path.join(dir, "nested", "spec.yaml");
    fs.writeFileSync(
      spec,
      [
        "output: ../relative.pdf",
        "pages:",
        "  - columns:",
        "      - - type: text",
        "          text: hi",
        "",
      ].join("\n"),
      "utf-8",
    );
    const destination = await generate(spec);
    expect(destination).toBe(path.join(dir, "relative.pdf"));
    expect(fs.existsSync(destination)).toBe(true);
  });
});
