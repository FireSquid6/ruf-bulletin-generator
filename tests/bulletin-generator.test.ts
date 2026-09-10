import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import {
  arrangeFoldedPages,
  generate,
  planFoldedFlow,
  validateSpec,
} from "../bulletin-generator";

const EXAMPLE_YAML = path.resolve(import.meta.dirname, "../example/example-dummy.yaml");

function writeSpec(dir: string, specText: string): string {
  const filePath = path.join(dir, "spec.yaml");
  fs.writeFileSync(filePath, specText, "utf-8");
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
