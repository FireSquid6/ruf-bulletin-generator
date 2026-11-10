import { describe, expect, spyOn, test } from "bun:test";
import PDFDocument from "pdfkit";
import { renderColumn } from "../src/render";

function renderParts(texts: string[], columns = 2) {
  const doc = new PDFDocument({ margin: 0 });
  const text = spyOn(doc, "text");
  renderColumn(doc, [{
    type: "song",
    title: "Test song",
    columns,
    parts: texts.map((text) => ({ text })),
  }], 20, 20, 400, 700, ".", 1);
  const positions = text.mock.calls.slice(1).map((call) => {
    const [text, x, y] = call as unknown as [string, number, number];
    return { text, x, y };
  });
  doc.end();
  return positions;
}

describe("song columns", () => {
  test("reads down the left column before the right column", () => {
    const positions = renderParts(["1", "2", "3", "4", "5", "6"]);
    expect(positions.filter((part) => part.x === 20).map((part) => part.text)).toEqual(["1", "2", "3"]);
    expect(positions.filter((part) => part.x > 20).map((part) => part.text)).toEqual(["4", "5", "6"]);
    expect(positions[0].y).toBe(positions[3].y);
    expect(positions[1].y).toBeGreaterThan(positions[0].y);
    expect(positions[2].y).toBeGreaterThan(positions[1].y);
  });

  test("puts the extra part in the left column when equal-sized parts cannot split evenly", () => {
    const positions = renderParts(["1", "2", "3", "4", "5"]);
    expect(positions.filter((part) => part.x === 20).map((part) => part.text)).toEqual(["1", "2", "3"]);
    expect(positions.filter((part) => part.x > 20).map((part) => part.text)).toEqual(["4", "5"]);
  });

  test("balances unequal parts without changing their order", () => {
    const longPart = "Long verse\n".repeat(10);
    const positions = renderParts([longPart, "2", "3", "4"]);
    expect(positions.filter((part) => part.x === 20).map((part) => part.text)).toEqual([longPart]);
    expect(positions.filter((part) => part.x > 20).map((part) => part.text)).toEqual(["2", "3", "4"]);
  });

  test("keeps a single part in the left column", () => {
    expect(renderParts(["1"]).map(({ text, x }) => ({ text, x }))).toEqual([{ text: "1", x: 20 }]);
  });

  test("leaves single-column songs in sequence", () => {
    const positions = renderParts(["1", "2", "3"], 1);
    expect(positions.map((part) => part.text)).toEqual(["1", "2", "3"]);
    expect(positions.every((part) => part.x === 20)).toBe(true);
  });
});
