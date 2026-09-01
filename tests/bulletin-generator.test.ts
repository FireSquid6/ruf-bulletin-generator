import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { validateSpec, generate } from "../bulletin-generator";

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
