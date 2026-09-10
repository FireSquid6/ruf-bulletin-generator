import fs from "node:fs";
import { MM, STYLES, type StyleName } from "./constants";
import { imageSize } from "./images";
import { resolvePath } from "./paths";
import type { Block, QrItem, SongPart } from "./types";

export type Doc = PDFKit.PDFDocument;

function styleByName(name: string) {
  const style = STYLES[name as StyleName];
  if (!style) throw new Error(`Unknown style: '${name}'`);
  return style;
}

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
  const { width: imageWidth, height: imageHeight } = imageSize(imagePath);
  const ratio = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  const renderedWidth = imageWidth * ratio;
  const renderedHeight = imageHeight * ratio;
  doc.image(imagePath, x + (width - renderedWidth) / 2, y, {
    width: renderedWidth,
    height: renderedHeight,
  });
  return y + renderedHeight;
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
    for (let index = 1; index < count; index++) {
      if (weights[index] < weights[target]) target = index;
    }
    columns[target].push(part);
    weights[target] += partWeight(part);
  }
  return columns;
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
  let leftY = cursor;
  let rightY = cursor;
  for (const part of groups[0]) leftY = renderPart(doc, part, x, leftY, subWidth, "body", effectiveScale);
  for (const part of groups[1]) {
    rightY = renderPart(doc, part, x + subWidth + gap, rightY, subWidth, "body", effectiveScale);
  }
  return Math.max(leftY, rightY);
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
  const columnWidth = width / contacts.length;
  let bottom = y;
  contacts.forEach((contact, index) => {
    const contactX = x + index * columnWidth;
    let contactY = renderText(doc, contact.name ?? "", contactX, y, columnWidth - 2 * MM, "bodyBold", scale);
    contactY = renderText(
      doc,
      contact.detail ?? "",
      contactX,
      contactY - 2.5 * MM * scale,
      columnWidth - 2 * MM,
      "body",
      scale,
    );
    bottom = Math.max(bottom, contactY);
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
      const defaultMaxHeight = isBranding ? height * 0.4 : height;
      const maxHeight = Math.min(
        height,
        block.max_height_mm !== undefined ? Number(block.max_height_mm) * MM : defaultMaxHeight,
      );
      const bottom = renderImage(doc, imagePath, x, y, width, maxWidth, maxHeight);
      return bottom + (isBranding ? 6 : 2) * MM;
    }
    case "qr": {
      const items = (block.items as QrItem[] | undefined) ?? [block as QrItem];
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

export function renderColumn(
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
