#!/usr/bin/env bun
/**
 * RUF bulletin generator -- one-sheet, duplex, landscape-A4 bulletin from YAML.
 *
 * Usage:
 *   bun run bulletin-generator.ts bulletin.yaml [-o out.pdf] [--debug]
 */

import fs from "node:fs";
import path from "node:path";
import YAML from "js-yaml";
import PDFDocument from "pdfkit";

// ---------- constants ----------

const MM = 72 / 25.4; // points per mm
const PAGE_W = 841.89; // A4 landscape, points
const PAGE_H = 595.28;
const DEFAULT_MARGIN_MM = 10;
const DEFAULT_GUTTER_MM = 8;
const SHRINK_SCALES = [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.55, 0.5];

// ---------- types ----------

type StyleName = "body" | "small" | "title" | "section" | "callout" | "center" | "right";

interface StyleDef {
  font: string;
  size: number;
  leading: number;
  spaceAfter: number; // mm
  align?: "left" | "center" | "right";
}

interface SongPart {
  text: string;
  label?: string;
  style?: string;
}

interface Block {
  type: string;
  [key: string]: unknown;
}

interface SpecPage {
  columns: Block[][];
  column_weights?: number[];
}

interface Spec {
  metadata?: Record<string, string>;
  layout?: { margin_mm?: number; gutter_mm?: number };
  output?: string;
  pages: SpecPage[];
}

const STYLES: Record<StyleName, StyleDef> = {
  body: { font: "Times-Roman", size: 9.5, leading: 11.4, spaceAfter: 2.5 },
  small: { font: "Times-Roman", size: 8.2, leading: 9.6, spaceAfter: 1.5 },
  title: { font: "Times-Bold", size: 13.5, leading: 15.5, spaceAfter: 2 },
  section: { font: "Times-Bold", size: 11.5, leading: 13.5, spaceAfter: 2 },
  callout: { font: "Times-Bold", size: 11, leading: 13, spaceAfter: 2 },
  center: { font: "Times-Bold", size: 10, leading: 12, spaceAfter: 1.5, align: "center" },
  right: { font: "Times-Bold", size: 9.5, leading: 11.4, spaceAfter: 0, align: "right" },
};

const BLOCK_TYPES = new Set([
  "song",
  "scripture",
  "announcements",
  "contacts",
  "heading",
  "text",
  "image",
  "branding",
  "qr",
  "spacer",
]);

type Doc = PDFKit.PDFDocument;

// ---------- helpers ----------

function resolvePath(value: string, yamlDir: string): string {
  const expanded = value.startsWith("~")
    ? value.replace(/^~/, process.env.HOME ?? "")
    : value;
  return path.isAbsolute(expanded) ? expanded : path.resolve(yamlDir, expanded);
}

function styleByName(name: string): StyleDef {
  const style = STYLES[name as StyleName];
  if (!style) throw new Error(`Unknown style: '${name}'`);
  return style;
}

/** Render a text block; returns the new y (bottom edge + spaceAfter). */
function renderText(
  doc: Doc,
  text: string,
  x: number,
  y: number,
  width: number,
  styleName: string,
  scale: number,
  italic = false,
): number {
  const style = styleByName(styleName);
  const size = style.size * scale;
  const lineGap = style.leading * scale - size;
  const opts = { width, align: style.align ?? ("left" as const), lineGap };
  doc.font(italic ? "Times-Italic" : style.font).fontSize(size).fillColor("black");
  const height = doc.heightOfString(text, opts);
  doc.text(text, x, y, opts);
  return y + height + style.spaceAfter * MM * scale;
}

/** Render a bold label prefix followed by normal text ("1. verse..."). */
function renderLabeledText(
  doc: Doc,
  label: string,
  text: string,
  x: number,
  y: number,
  width: number,
  styleName: string,
  scale: number,
  italic = false,
): number {
  const style = styleByName(styleName);
  const size = style.size * scale;
  const lineGap = style.leading * scale - size;
  const opts = { width, lineGap };
  const height = doc.heightOfString(`${label} ${text}`, opts);
  doc.font("Times-Bold").fontSize(size).fillColor("black");
  doc.text(`${label} `, x, y, { ...opts, continued: true });
  doc.font(italic ? "Times-Italic" : style.font);
  doc.text(text, opts);
  return y + height + style.spaceAfter * MM * scale;
}

function renderImage(
  doc: Doc,
  imagePath: string,
  x: number,
  y: number,
  width: number,
  maxWidth: number,
  maxHeight: number,
): number {
  // `fit` scales the image proportionally inside the box; `align` centers it.
  doc.image(imagePath, x, y, {
    fit: [maxWidth, maxHeight],
    align: "center",
    valign: "top",
  } as never);
  const { width: iw, height: ih } = imageSize(imagePath);
  const ratio = Math.min(maxWidth / iw, maxHeight / ih);
  return y + ih * ratio;
}

function imageSize(imagePath: string): { width: number; height: number } {
  const data = fs.readFileSync(imagePath);
  // PNG: IHDR at bytes 16-24; JPEG: walk SOF markers.
  if (data[0] === 0x89 && data[1] === 0x50) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset < data.length) {
      if (data[offset] !== 0xff) { offset++; continue; }
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  throw new Error(`Unsupported image format: ${imagePath}`);
}

function partWeight(part: SongPart): number {
  const text = part.text ?? "";
  return Math.max(1, Math.floor(text.length / 42) + text.split("\n").length);
}

function balancedParts(parts: SongPart[], count: number): SongPart[][] {
  const columns: SongPart[][] = Array.from({ length: count }, () => []);
  const weights = new Array(count).fill(0);
  for (const part of parts) {
    let target = 0;
    for (let i = 1; i < count; i++) if (weights[i] < weights[target]) target = i;
    columns[target].push(part);
    weights[target] += partWeight(part);
  }
  return columns;
}

// ---------- block renderers ----------

function renderSong(doc: Doc, block: Block, x: number, y: number, width: number, scale: number): number {
  const title = block.title as string | undefined;
  const parts = block.parts as SongPart[] | undefined;
  if (!title || !Array.isArray(parts) || parts.length === 0) {
    throw new Error("A song requires a title and a non-empty parts list");
  }
  const columnCount = Number(block.columns ?? 1);
  if (columnCount !== 1 && columnCount !== 2) {
    throw new Error(`Song '${title}' columns must be 1 or 2`);
  }

  let cursor = renderText(doc, title, x, y, width, "section", scale);

  if (columnCount === 1) {
    for (const part of parts) {
      cursor = renderPart(doc, part, x, cursor, width, "body", scale);
    }
    return cursor;
  }

  const gap = 4 * MM;
  const subWidth = (width - gap) / 2;
  const groups = balancedParts(parts, 2);
  let yLeft = cursor;
  let yRight = cursor;
  for (const part of groups[0]) yLeft = renderPart(doc, part, x, yLeft, subWidth, "small", scale);
  for (const part of groups[1]) {
    yRight = renderPart(doc, part, x + subWidth + gap, yRight, subWidth, "small", scale);
  }
  return Math.max(yLeft, yRight);
}

function renderPart(
  doc: Doc,
  part: SongPart,
  x: number,
  y: number,
  width: number,
  styleName: string,
  scale: number,
): number {
  if (typeof part.text !== "string") throw new Error("A song part requires text");
  const italic = part.style === "chorus";
  if (part.label) {
    return renderLabeledText(doc, part.label, part.text, x, y, width, styleName, scale, italic);
  }
  return renderText(doc, part.text, x, y, width, styleName, scale, italic);
}

function renderScripture(doc: Doc, block: Block, x: number, y: number, width: number, scale: number): number {
  const reference = block.reference as string | undefined;
  const text = block.text as string | undefined;
  if (!reference || !text) throw new Error("A scripture block requires reference and text");
  const label = (block.label as string | undefined) ?? "Scripture Reading";
  const textStyle = (block.text_style as string | undefined) ?? "body";
  let cursor = renderText(doc, `${label} - ${reference}`, x, y, width, "section", scale);
  cursor = renderText(doc, `\u201C${text}\u201D`, x, cursor, width, textStyle, scale);
  return cursor;
}

function renderAnnouncements(doc: Doc, block: Block, x: number, y: number, width: number, scale: number): number {
  const title = (block.title as string | undefined) ?? "Announcements";
  const date = (block.date as string | undefined) ?? "";

  // Header row: title left (62%), date right-aligned across the full width.
  const headerStyle = styleByName("section");
  const size = headerStyle.size * scale;
  const lineGap = headerStyle.leading * scale - size;
  doc.font(headerStyle.font).fontSize(size).fillColor("black");
  const titleOpts = { width: width * 0.62, lineGap };
  const titleHeight = doc.heightOfString(title, titleOpts);
  doc.text(title, x, y, titleOpts);
  let headerBottom = y + titleHeight;
  if (date) {
    const dateOpts = { width, align: "right" as const, lineGap };
    doc.font(styleByName("right").font);
    const dateHeight = doc.heightOfString(date, dateOpts);
    doc.text(date, x, y, dateOpts);
    headerBottom = Math.max(headerBottom, y + dateHeight);
  }
  let cursor = headerBottom + 1 * MM * scale;

  const items = (block.items as Array<string | { title?: string; text?: string }>) ?? [];
  for (const item of items) {
    if (typeof item === "string") {
      cursor = renderText(doc, item, x, cursor, width, "body", scale);
    } else if (item.text) {
      cursor = renderLabeledText(doc, item.title ?? "", item.text, x, cursor, width, "body", scale);
    } else {
      cursor = renderText(doc, item.title ?? "", x, cursor, width, "body", scale);
    }
  }
  return cursor;
}

function renderContacts(doc: Doc, block: Block, x: number, y: number, width: number, scale: number): number {
  const contacts = (block.items as Array<{ name?: string; detail?: string }>) ?? [];
  if (contacts.length === 0) return y;
  const colWidth = width / contacts.length;
  let bottom = y;
  contacts.forEach((contact, index) => {
    const cx = x + index * colWidth;
    let cy = renderText(doc, contact.name ?? "", cx, y, colWidth - 2 * MM, "small", scale);
    cy = renderText(doc, contact.detail ?? "", cx, cy - 1.5 * MM * scale, colWidth - 2 * MM, "small", scale);
    bottom = Math.max(bottom, cy);
  });
  return bottom;
}

function renderBlock(
  doc: Doc,
  block: Block,
  x: number,
  y: number,
  width: number,
  height: number,
  yamlDir: string,
  scale: number,
): number {
  switch (block.type) {
    case "song":
      return renderSong(doc, block, x, y, width, scale);
    case "scripture":
      return renderScripture(doc, block, x, y, width, scale);
    case "announcements":
      return renderAnnouncements(doc, block, x, y, width, scale);
    case "contacts":
      return renderContacts(doc, block, x, y, width, scale);
    case "heading":
      return renderText(doc, block.text as string, x, y, width, (block.style as string) ?? "callout", scale);
    case "text":
      return renderText(doc, block.text as string, x, y, width, (block.style as string) ?? "body", scale);
    case "image":
    case "branding": {
      const imagePath = resolvePath(block.path as string, yamlDir);
      if (!fs.existsSync(imagePath)) throw new Error(`Image does not exist: ${imagePath}`);
      const maxWidth = Math.min(width, Number(block.max_width_mm ?? width / MM) * MM);
      const maxHeight = Math.min(height, Number(block.max_height_mm ?? height / MM) * MM);
      const bottom = renderImage(doc, imagePath, x, y, width, maxWidth, maxHeight);
      return bottom + 2 * MM;
    }
    case "qr": {
      const imagePath = resolvePath(block.path as string, yamlDir);
      if (!fs.existsSync(imagePath)) throw new Error(`Image does not exist: ${imagePath}`);
      const size = Math.min(width, Number(block.size_mm ?? 28) * MM);
      let cursor = y;
      if (block.caption) cursor = renderText(doc, block.caption as string, x, cursor, width, "center", scale);
      const bottom = renderImage(doc, imagePath, x, cursor, width, size, size);
      return bottom + 1.5 * MM;
    }
    case "spacer":
      return y + Number(block.height_mm ?? 3) * MM;
    default:
      throw new Error(`Unknown block type: '${block.type}'`);
  }
}

function renderColumn(
  doc: Doc,
  blocks: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  yamlDir: string,
  scale: number,
): number {
  let y = yTop;
  for (const block of blocks) {
    y = renderBlock(doc, block, x, y, width, height, yamlDir, scale);
  }
  return y;
}

/**
 * Probe whether a column fits vertically at a given scale. Renders into a
 * throwaway document and reports failure if pdfkit auto-breaks to a new page
 * or the content bottom passes the limit.
 */
function columnFits(
  blocks: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  yamlDir: string,
  scale: number,
  bottomLimit: number,
): boolean {
  const probe = new PDFDocument({ size: [PAGE_W, PAGE_H], compress: false }) as Doc;
  let overflowed = false;
  const addPage = probe.addPage.bind(probe);
  probe.addPage = (() => {
    overflowed = true;
    return addPage();
  }) as typeof probe.addPage;

  const bottom = renderColumn(probe, blocks, x, yTop, width, height, yamlDir, scale);
  return !overflowed && bottom >= bottomLimit;
}

// ---------- validation ----------

export function validateSpec(spec: unknown): asserts spec is Spec {
  if (typeof spec !== "object" || spec === null) throw new Error("The YAML root must be a mapping");
  const pages = (spec as Spec).pages;
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > 2) {
    throw new Error("'pages' must contain one or two sides for one physical sheet");
  }
  pages.forEach((page, pageNumber) => {
    const columns = page?.columns;
    if (!Array.isArray(columns) || columns.length === 0) {
      throw new Error(`Page ${pageNumber + 1} requires a non-empty columns list`);
    }
    if (columns.length > 3) {
      throw new Error(`Page ${pageNumber + 1} may have at most three columns`);
    }
    columns.forEach((column, columnIndex) => {
      if (!Array.isArray(column)) {
        throw new Error(`Page ${pageNumber + 1}, column ${columnIndex + 1} must be a list`);
      }
      for (const block of column) {
        if (
          typeof block !== "object" ||
          block === null ||
          typeof block.type !== "string" ||
          !BLOCK_TYPES.has(block.type)
        ) {
          throw new Error(
            `Page ${pageNumber + 1}, column ${columnIndex + 1} has an invalid block` +
              (block && typeof block === "object" && "type" in block
                ? ` (unknown type '${(block as Block).type}')`
                : ""),
          );
        }
      }
    });
  });
}

// ---------- generation ----------

export async function generate(yamlPath: string, outputOverride?: string, debug = false): Promise<string> {
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const spec = YAML.load(raw) as unknown;
  validateSpec(spec);

  const yamlDir = path.dirname(path.resolve(yamlPath));
  const configuredOutput = spec.output ?? "bulletin.pdf";
  const destination = outputOverride ?? resolvePath(configuredOutput, yamlDir);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const margin = Number(spec.layout?.margin_mm ?? DEFAULT_MARGIN_MM) * MM;
  const gutter = Number(spec.layout?.gutter_mm ?? DEFAULT_GUTTER_MM) * MM;
  const contentHeight = PAGE_H - 2 * margin;
  const bottomLimit = margin - 2; // small tolerance

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], compress: true }) as Doc;
  const metadata = spec.metadata ?? {};
  doc.info.Title = metadata.title ?? "RUF Bulletin";
  doc.info.Author = metadata.author ?? "Reformed University Fellowship";
  doc.info.Subject = metadata.subject ?? "Weekly bulletin";
  const stream = fs.createWriteStream(destination);
  doc.pipe(stream);

  spec.pages.forEach((page, pageIndex) => {
    if (pageIndex > 0) doc.addPage();

    const columns = page.columns;
    const weights = page.column_weights ?? columns.map(() => 1);
    if (weights.length !== columns.length || weights.some((w) => Number(w) <= 0)) {
      throw new Error("column_weights must be positive and match the number of columns");
    }
    const availableWidth = PAGE_W - 2 * margin - gutter * (columns.length - 1);
    const totalWeight = weights.reduce((sum, w) => sum + Number(w), 0);
    const widths = weights.map((w) => (availableWidth * Number(w)) / totalWeight);

    let x = margin;
    for (const [index, blocks] of columns.entries()) {
      const width = widths[index];
      // Pick the largest scale that keeps this column on the sheet.
      let chosen = SHRINK_SCALES[SHRINK_SCALES.length - 1];
      for (const scale of SHRINK_SCALES) {
        if (columnFits(blocks, x, margin, width, contentHeight, yamlDir, scale, bottomLimit)) {
          chosen = scale;
          break;
        }
      }
      renderColumn(doc, blocks, x, margin, width, contentHeight, yamlDir, chosen);
      if (debug) {
        doc.save().strokeColor("#c9c9c9").lineWidth(0.5).rect(x, margin, width, contentHeight).stroke().restore();
      }
      x += width + gutter;
    }
  });

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", () => resolve());
    stream.on("error", (err) => reject(err));
  });
  return destination;
}

// ---------- CLI ----------

const USAGE = "Usage: bun run bulletin-generator.ts <bulletin.yaml> [-o out.pdf] [--debug]";

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  let yamlFile: string | null = null;
  let output: string | undefined;
  let debug = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-o" || arg === "--output") output = args[++i];
    else if (arg === "--debug") debug = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(USAGE);
      return 0;
    } else if (yamlFile === null) yamlFile = arg;
    else {
      console.error(`error: unexpected argument '${arg}'`);
      return 2;
    }
  }
  if (!yamlFile) {
    console.error(USAGE);
    return 2;
  }
  try {
    const destination = await generate(yamlFile, output, debug);
    console.log(destination);
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

if (import.meta.main) {
  main();
}
