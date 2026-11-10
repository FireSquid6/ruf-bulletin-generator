import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { renderPdf, type Spec } from "../src";

const asset = fs.readFileSync(path.resolve(import.meta.dirname, "../../../assets/ruf-baylor-logo.png"));

describe("renderPdf from bulletin data", () => {
  test("renders PDF bytes from a validated in-memory bulletin without an input or output file", async () => {
    const spec: Spec = {
      metadata: { title: "In-memory bulletin" },
      cover: [{ type: "branding", path: "logo" }],
      flow: [{ type: "song", song_ref: "opening" }, { type: "text", text: "Welcome" }],
    };
    const pdf = await renderPdf(spec, {
      assets: { logo: asset },
      songStore: { songs: { opening: { title: "Opening", parts: [{ text: "A verse" }] } } },
    });
    expect(pdf.subarray(0, 8).toString()).toStartWith("%PDF-");
    expect(pdf.toString("latin1").match(/\/Type \/Page[^s]/g)?.length).toBe(2);
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(spec.flow![0].song_ref).toBe("opening"); // Resolution must not rewrite caller's draft.
  });

  test("does not fall back to the filesystem for an unprovided asset", async () => {
    const spec: Spec = {
      cover: [{ type: "branding", path: path.resolve(import.meta.dirname, "../../../assets/ruf-baylor-logo.png") }],
      flow: [],
    };
    await expect(renderPdf(spec)).rejects.toThrow(/Image .*not available/);
  });

  test("reports unresolved songs and invalid data before returning PDF bytes", async () => {
    await expect(renderPdf({ cover: [], flow: [{ type: "song", song_ref: "missing" }] }))
      .rejects.toThrow(/song store/);
    await expect(renderPdf({ cover: [], flow: [{ type: "song", song_ref: "missing" }] }, { songStore: { songs: {} } }))
      .rejects.toThrow("Song 'missing' referenced by Flow block 1");
    await expect(renderPdf({ pages: [] })).rejects.toThrow("'pages'");
    await expect(renderPdf({ cover: [], flow: [] }, {
      songStore: { songs: { broken: { title: "Broken", parts: [] } } },
    })).rejects.toThrow("non-empty parts list");
  });

  test("renders QR assets by key and reports missing QR entries", async () => {
    const spec: Spec = { cover: [], flow: [{ type: "qr", items: [{ path: "qr-one", caption: "Join" }] }] };
    expect((await renderPdf(spec, { assets: { "qr-one": asset } })).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(renderPdf(spec, { assets: {} })).rejects.toThrow("Image 'qr-one' is not available");
  });

  test("does not write an output file when rendering fails", async () => {
    const output = path.join(fs.mkdtempSync("/tmp/ruf-pdf-data-"), "unrenderable.pdf");
    await expect(renderPdf({ output, cover: [], flow: [{ type: "spacer", height_mm: 500 }] }))
      .rejects.toThrow("does not fit");
    expect(fs.existsSync(output)).toBe(false);
  });
});
