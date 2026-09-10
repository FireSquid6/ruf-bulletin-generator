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
const DEFAULT_HORIZONTAL_MARGIN_MM = 7;
const DEFAULT_VERTICAL_MARGIN_MM = 4;
const DEFAULT_GUTTER_MM = 14;
const MIN_FONT_SCALE = 0.5;
const MAX_FONT_SCALE = 4;
const SCALE_SEARCH_STEPS = 16;

// ---------- types ----------

type StyleName = "body" | "small" | "smallBold" | "title" | "section" | "callout" | "center" | "right";

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

interface QrItem {
  path?: string;
  caption?: string;
  size_mm?: number;
}

interface SpecPage {
  columns: Block[][];
  column_weights?: number[];
}

interface Spec {
  metadata?: Record<string, string>;
  layout?: {
    margin_mm?: number;
    horizontal_margin_mm?: number;
    vertical_margin_mm?: number;
    gutter_mm?: number;
  };
  output?: string;
  folded?: boolean;
  cover?: Block[];
  flow?: Block[];
  pages?: SpecPage[];
}

export interface FoldedFlowPlan {
  scale: number;
  columns: [Block[], Block[], Block[]];
}

export function arrangeFoldedPages(
  cover: Block[],
  columns: FoldedFlowPlan["columns"],
): [[Block[], Block[]], [Block[], Block[]]] {
  return [[columns[2], cover], [columns[0], columns[1]]];
}

const STYLES: Record<StyleName, StyleDef> = {
  body: { font: "Times-Roman", size: 11, leading: 13.2, spaceAfter: 2.5 },
  small: { font: "Times-Roman", size: 9.5, leading: 11.1, spaceAfter: 1.5 },
  smallBold: { font: "Times-Bold", size: 9.5, leading: 11.1, spaceAfter: 1.5 },
  title: { font: "Times-Bold", size: 15.5, leading: 17.8, spaceAfter: 2 },
  section: { font: "Times-Bold", size: 13, leading: 15.2, spaceAfter: 2 },
  callout: { font: "Times-Bold", size: 12.5, leading: 14.7, spaceAfter: 2 },
  center: { font: "Times-Bold", size: 11.5, leading: 13.7, spaceAfter: 1.5, align: "center" },
  right: { font: "Times-Bold", size: 11, leading: 13.2, spaceAfter: 0, align: "right" },
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

  // heightOfString uses the document's current font settings. The first
  // labeled verse after a song title previously inherited the title's larger
  // bold font for measurement, even though the verse itself was drawn using
  // the smaller body font. That advanced the cursor too far and left a large
  // gap before the next verse in the same subcolumn.
  doc.font(italic ? "Times-Italic" : style.font).fontSize(size);
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
  const { width: iw, height: ih } = imageSize(imagePath);
  const ratio = Math.min(maxWidth / iw, maxHeight / ih);
  const w = iw * ratio;
  const h = ih * ratio;
  // Center horizontally within the column (x..x+width), not the fit box.
  doc.image(imagePath, x + (width - w) / 2, y, { width: w, height: h });
  return y + h;
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
  const songScale = Number(block.scale ?? 1);
  if (!Number.isFinite(songScale) || songScale <= 0) {
    throw new Error(`Song '${title}' scale must be a positive number`);
  }
  const effectiveScale = scale * songScale;

  let cursor = renderText(doc, title, x, y, width, "section", scale);

  if (columnCount === 1) {
    for (const part of parts) {
      cursor = renderPart(doc, part, x, cursor, width, "body", effectiveScale);
    }
    return cursor;
  }

  const gap = 4 * MM;
  const subWidth = (width - gap) / 2;
  const groups = balancedParts(parts, 2);
  let yLeft = cursor;
  let yRight = cursor;
  for (const part of groups[0]) yLeft = renderPart(doc, part, x, yLeft, subWidth, "body", effectiveScale);
  for (const part of groups[1]) {
    yRight = renderPart(doc, part, x + subWidth + gap, yRight, subWidth, "body", effectiveScale);
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
    let cy = renderText(doc, contact.name ?? "", cx, y, colWidth - 2 * MM, "smallBold", scale);
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
      const isBranding = block.type === "branding";
      const maxWidth = Math.min(width, Number(block.max_width_mm ?? width / MM) * MM);
      const maxHeightDefault = isBranding ? height * 0.4 : height;
      const maxHeight = Math.min(
        height,
        block.max_height_mm !== undefined ? Number(block.max_height_mm) * MM : maxHeightDefault,
      );
      const bottom = renderImage(doc, imagePath, x, y, width, maxWidth, maxHeight);
      return bottom + (isBranding ? 6 : 2) * MM;
    }
    case "qr": {
      const items = ((block.items as QrItem[] | undefined) ?? [block as QrItem]);
      if (items.length === 0) throw new Error("A QR block requires at least one item");
      const gap = 4 * MM;
      const itemWidth = (width - gap * (items.length - 1)) / items.length;
      let bottom = y;

      items.forEach((item, index) => {
        if (!item.path) throw new Error("A QR item requires a path");
        const imagePath = resolvePath(item.path, yamlDir);
        if (!fs.existsSync(imagePath)) throw new Error(`Image does not exist: ${imagePath}`);
        const itemX = x + index * (itemWidth + gap);
        const size = Math.min(itemWidth, Number(item.size_mm ?? block.size_mm ?? 28) * MM);
        let cursor = y;
        if (item.caption) cursor = renderText(doc, item.caption, itemX, cursor, itemWidth, "center", scale);
        bottom = Math.max(bottom, renderImage(doc, imagePath, itemX, cursor, itemWidth, size, size));
      });

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
): boolean {
  const probe = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, compress: false }) as Doc;
  let overflowed = false;
  const addPage = probe.addPage.bind(probe);
  probe.addPage = (() => {
    overflowed = true;
    return addPage();
  }) as typeof probe.addPage;

  const bottom = renderColumn(probe, blocks, x, yTop, width, height, yamlDir, scale);
  return !overflowed && bottom <= yTop + height + 2;
}

function partitionFlow(
  flow: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  yamlDir: string,
  scale: number,
): [Block[], Block[], Block[]] | null {
  const columns: Block[][] = [];
  let start = 0;

  for (let columnIndex = 0; columnIndex < 3; columnIndex++) {
    let end = start;
    while (
      end < flow.length &&
      columnFits(flow.slice(start, end + 1), x, yTop, width, height, yamlDir, scale)
    ) {
      end++;
    }
    columns.push(flow.slice(start, end));
    start = end;
  }

  return start === flow.length ? columns as [Block[], Block[], Block[]] : null;
}

function foldedPlanAtScale(
  cover: Block[],
  flow: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  yamlDir: string,
  scale: number,
): FoldedFlowPlan | null {
  if (!columnFits(cover, x, yTop, width, height, yamlDir, scale)) return null;
  const columns = partitionFlow(flow, x, yTop, width, height, yamlDir, scale);
  return columns ? { scale, columns } : null;
}

export function planFoldedFlow(
  cover: Block[],
  flow: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  yamlDir: string,
): FoldedFlowPlan {
  let low = MIN_FONT_SCALE;
  let lowPlan = foldedPlanAtScale(cover, flow, x, yTop, width, height, yamlDir, low);
  if (!lowPlan) {
    throw new Error(`Bulletin content does not fit at the minimum font scale (${MIN_FONT_SCALE})`);
  }

  let high = 1;
  let highPlan = foldedPlanAtScale(cover, flow, x, yTop, width, height, yamlDir, high);
  if (highPlan) {
    low = high;
    lowPlan = highPlan;
    while (high < MAX_FONT_SCALE) {
      high = Math.min(high * 2, MAX_FONT_SCALE);
      highPlan = foldedPlanAtScale(cover, flow, x, yTop, width, height, yamlDir, high);
      if (!highPlan) break;
      low = high;
      lowPlan = highPlan;
      if (high === MAX_FONT_SCALE) return lowPlan;
    }
  }

  for (let step = 0; step < SCALE_SEARCH_STEPS; step++) {
    const scale = (low + high) / 2;
    const plan = foldedPlanAtScale(cover, flow, x, yTop, width, height, yamlDir, scale);
    if (plan) {
      low = scale;
      lowPlan = plan;
    } else {
      high = scale;
    }
  }

  return lowPlan;
}

function largestColumnScale(
  blocks: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  yamlDir: string,
): number {
  if (!columnFits(blocks, x, yTop, width, height, yamlDir, MIN_FONT_SCALE)) {
    throw new Error(`Column content does not fit at the minimum font scale (${MIN_FONT_SCALE})`);
  }

  let low = MIN_FONT_SCALE;
  let high = 1;
  if (columnFits(blocks, x, yTop, width, height, yamlDir, high)) {
    low = high;
    while (high < MAX_FONT_SCALE) {
      high = Math.min(high * 2, MAX_FONT_SCALE);
      if (!columnFits(blocks, x, yTop, width, height, yamlDir, high)) break;
      low = high;
      if (high === MAX_FONT_SCALE) return high;
    }
  }

  for (let step = 0; step < SCALE_SEARCH_STEPS; step++) {
    const scale = (low + high) / 2;
    if (columnFits(blocks, x, yTop, width, height, yamlDir, scale)) low = scale;
    else high = scale;
  }
  return low;
}

// ---------- validation ----------

export function validateSpec(spec: unknown): asserts spec is Spec {
  if (typeof spec !== "object" || spec === null) throw new Error("The YAML root must be a mapping");
  const typedSpec = spec as Spec;
  const usesFoldedFlow = typedSpec.cover !== undefined || typedSpec.flow !== undefined;

  const validateBlocks = (blocks: unknown[], location: string) => {
    for (const block of blocks) {
      if (
        typeof block !== "object" ||
        block === null ||
        typeof (block as Block).type !== "string" ||
        !BLOCK_TYPES.has((block as Block).type)
      ) {
        throw new Error(
          `${location} has an invalid block` +
            (block && typeof block === "object" && "type" in block
              ? ` (unknown type '${(block as Block).type}')`
              : ""),
        );
      }
    }
  };

  if (usesFoldedFlow) {
    if (typedSpec.pages !== undefined || typedSpec.folded !== undefined) {
      throw new Error("Use either 'cover' and 'flow' or 'pages', not both");
    }
    if (!Array.isArray(typedSpec.cover)) throw new Error("'cover' must be a list of blocks");
    if (!Array.isArray(typedSpec.flow)) throw new Error("'flow' must be a list of blocks");
    validateBlocks(typedSpec.cover, "Cover");
    validateBlocks(typedSpec.flow, "Flow");
    return;
  }

  const pages = typedSpec.pages;
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
      validateBlocks(column, `Page ${pageNumber + 1}, column ${columnIndex + 1}`);
    });
  });
  if (typedSpec.folded && (pages.length !== 2 || pages.some((page) => page.columns.length !== 2))) {
    throw new Error("A folded pages layout requires exactly two pages with two columns each");
  }
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

  const horizontalMargin = Number(
    spec.layout?.horizontal_margin_mm ?? spec.layout?.margin_mm ?? DEFAULT_HORIZONTAL_MARGIN_MM,
  ) * MM;
  const verticalMargin = Number(
    spec.layout?.vertical_margin_mm ?? spec.layout?.margin_mm ?? DEFAULT_VERTICAL_MARGIN_MM,
  ) * MM;
  const gutter = Number(spec.layout?.gutter_mm ?? DEFAULT_GUTTER_MM) * MM;
  const contentHeight = PAGE_H - 2 * verticalMargin;

  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, compress: true }) as Doc;
  const metadata = spec.metadata ?? {};
  doc.info.Title = metadata.title ?? "RUF Bulletin";
  doc.info.Author = metadata.author ?? "Reformed University Fellowship";
  doc.info.Subject = metadata.subject ?? "Weekly bulletin";
  const stream = fs.createWriteStream(destination);
  doc.pipe(stream);

  const drawGuide = (x: number, width: number) => {
    if (!debug) return;
    doc.save().strokeColor("#c9c9c9").lineWidth(0.5)
      .rect(x, verticalMargin, width, contentHeight).stroke().restore();
  };

  const foldedCover = spec.cover ?? (spec.folded ? spec.pages![0].columns[1] : undefined);
  const foldedFlow = spec.flow ?? (spec.folded
    ? [
        ...spec.pages![1].columns[0],
        ...spec.pages![1].columns[1],
        ...spec.pages![0].columns[0],
      ]
    : undefined);

  if (foldedCover && foldedFlow) {
    const width = (PAGE_W - 2 * horizontalMargin - gutter) / 2;
    const leftX = horizontalMargin;
    const rightX = leftX + width + gutter;
    const plan = planFoldedFlow(
      foldedCover,
      foldedFlow,
      leftX,
      verticalMargin,
      width,
      contentHeight,
      yamlDir,
    );
    const pages = arrangeFoldedPages(foldedCover, plan.columns);

    renderColumn(doc, pages[0][0], leftX, verticalMargin, width, contentHeight, yamlDir, plan.scale);
    renderColumn(doc, pages[0][1], rightX, verticalMargin, width, contentHeight, yamlDir, plan.scale);
    drawGuide(leftX, width);
    drawGuide(rightX, width);

    doc.addPage();
    renderColumn(doc, pages[1][0], leftX, verticalMargin, width, contentHeight, yamlDir, plan.scale);
    renderColumn(doc, pages[1][1], rightX, verticalMargin, width, contentHeight, yamlDir, plan.scale);
    drawGuide(leftX, width);
    drawGuide(rightX, width);
  } else {
    spec.pages!.forEach((page, pageIndex) => {
      if (pageIndex > 0) doc.addPage();

      const columns = page.columns;
      const weights = page.column_weights ?? columns.map(() => 1);
      if (weights.length !== columns.length || weights.some((w) => Number(w) <= 0)) {
        throw new Error("column_weights must be positive and match the number of columns");
      }
      const availableWidth = PAGE_W - 2 * horizontalMargin - gutter * (columns.length - 1);
      const totalWeight = weights.reduce((sum, w) => sum + Number(w), 0);
      const widths = weights.map((w) => (availableWidth * Number(w)) / totalWeight);

      let x = horizontalMargin;
      for (const [index, blocks] of columns.entries()) {
        const width = widths[index];
        const chosen = largestColumnScale(
          blocks,
          x,
          verticalMargin,
          width,
          contentHeight,
          yamlDir,
        );
        renderColumn(doc, blocks, x, verticalMargin, width, contentHeight, yamlDir, chosen);
        drawGuide(x, width);
        x += width + gutter;
      }
    });
  }

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
