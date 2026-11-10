export const MM = 72 / 25.4;
export const PAGE_W = 841.89;
export const PAGE_H = 595.28;
export const DEFAULT_HORIZONTAL_MARGIN_MM = 7;
export const DEFAULT_VERTICAL_MARGIN_MM = 4;
export const DEFAULT_GUTTER_MM = 14;
export const MIN_FONT_SCALE = 0.5;
export const MAX_FONT_SCALE = 4;
export const SCALE_SEARCH_STEPS = 16;

export type StyleName =
  | "body"
  | "bodyBold"
  | "small"
  | "smallBold"
  | "title"
  | "section"
  | "callout"
  | "center"
  | "right";

export interface StyleDef {
  font: string;
  size: number;
  leading: number;
  spaceAfter: number;
  align?: "left" | "center" | "right";
}

export const STYLES: Record<StyleName, StyleDef> = {
  body: { font: "Times-Roman", size: 13, leading: 13.2, spaceAfter: 2.5 },
  bodyBold: { font: "Times-Bold", size: 13, leading: 13.2, spaceAfter: 2.5 },
  small: { font: "Times-Roman", size: 10, leading: 11.1, spaceAfter: 1.5 },
  smallBold: { font: "Times-Bold", size: 10, leading: 11.1, spaceAfter: 1.5 },
  title: { font: "Times-Bold", size: 16, leading: 17.8, spaceAfter: 2 },
  section: { font: "Times-Bold", size: 13, leading: 15.2, spaceAfter: 2 },
  callout: { font: "Times-Bold", size: 12.5, leading: 14.7, spaceAfter: 2 },
  center: { font: "Times-Bold", size: 12, leading: 13.7, spaceAfter: 1.5, align: "center" },
  right: { font: "Times-Bold", size: 12, leading: 13.2, spaceAfter: 0, align: "right" },
};

export const BLOCK_TYPES = new Set([
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
