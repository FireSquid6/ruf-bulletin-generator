import PDFDocument from "pdfkit";
import {
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  PAGE_H,
  PAGE_W,
  SCALE_SEARCH_STEPS,
} from "./constants";
import { renderColumn, type Doc, type ImageSource } from "./render";
import type { Block, FoldedFlowPlan } from "./types";

export function arrangeFoldedPages(
  cover: Block[],
  columns: FoldedFlowPlan["columns"],
): [[Block[], Block[]], [Block[], Block[]]] {
  return [[columns[2], cover], [columns[0], columns[1]]];
}

function columnFits(
  blocks: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  imageSource: ImageSource,
  scale: number,
): boolean {
  const probe = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, compress: false }) as Doc;
  let overflowed = false;
  const addPage = probe.addPage.bind(probe);
  probe.addPage = (() => {
    overflowed = true;
    return addPage();
  }) as typeof probe.addPage;

  const bottom = renderColumn(probe, blocks, x, yTop, width, height, imageSource, scale);
  return !overflowed && bottom <= yTop + height + 2;
}

function partitionFlow(
  flow: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  imageSource: ImageSource,
  scale: number,
): [Block[], Block[], Block[]] | null {
  const columns: Block[][] = [];
  const remaining = [...flow];

  for (let columnIndex = 0; columnIndex < 3; columnIndex++) {
    const column: Block[] = [];
    while (remaining.length > 0) {
      const block = remaining[0];
      const fits = (candidate: Block) =>
        columnFits([...column, candidate], x, yTop, width, height, imageSource, scale);
      if (fits(block)) {
        column.push(remaining.shift()!);
        continue;
      }
      if (block.type === "scripture" && typeof block.text === "string" && columnIndex < 2) {
        const words = block.text.trim().split(/\s+/);
        let low = 0;
        let high = words.length - 1;
        while (low < high) {
          const end = Math.ceil((low + high) / 2);
          if (fits({ ...block, text: words.slice(0, end).join(" ") })) low = end;
          else high = end - 1;
        }
        if (low > 0) {
          column.push({ ...block, text: words.slice(0, low).join(" ") });
          remaining[0] = {
            ...block,
            text: words.slice(low).join(" "),
            label: `${((block.label as string | undefined) ?? "Scripture Reading").replace(/ \(continued\)$/, "")} (continued)`,
          };
        }
      }
      break;
    }
    columns.push(column);
  }

  return remaining.length === 0 ? columns as [Block[], Block[], Block[]] : null;
}

function foldedPlanAtScale(
  cover: Block[],
  flow: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  imageSource: ImageSource,
  scale: number,
): FoldedFlowPlan | null {
  if (!columnFits(cover, x, yTop, width, height, imageSource, scale)) return null;
  const columns = partitionFlow(flow, x, yTop, width, height, imageSource, scale);
  return columns ? { scale, columns } : null;
}

export function planFoldedFlow(
  cover: Block[],
  flow: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  imageSource: ImageSource,
): FoldedFlowPlan {
  let low = MIN_FONT_SCALE;
  let lowPlan = foldedPlanAtScale(cover, flow, x, yTop, width, height, imageSource, low);
  if (!lowPlan) {
    throw new Error(`Bulletin content does not fit at the minimum font scale (${MIN_FONT_SCALE})`);
  }

  let high = 1;
  let highPlan = foldedPlanAtScale(cover, flow, x, yTop, width, height, imageSource, high);
  if (highPlan) {
    low = high;
    lowPlan = highPlan;
    while (high < MAX_FONT_SCALE) {
      high = Math.min(high * 2, MAX_FONT_SCALE);
      highPlan = foldedPlanAtScale(cover, flow, x, yTop, width, height, imageSource, high);
      if (!highPlan) break;
      low = high;
      lowPlan = highPlan;
      if (high === MAX_FONT_SCALE) return lowPlan;
    }
  }

  for (let step = 0; step < SCALE_SEARCH_STEPS; step++) {
    const scale = (low + high) / 2;
    const plan = foldedPlanAtScale(cover, flow, x, yTop, width, height, imageSource, scale);
    if (plan) {
      low = scale;
      lowPlan = plan;
    } else {
      high = scale;
    }
  }

  return lowPlan;
}

export function largestColumnScale(
  blocks: Block[],
  x: number,
  yTop: number,
  width: number,
  height: number,
  imageSource: ImageSource,
): number {
  if (!columnFits(blocks, x, yTop, width, height, imageSource, MIN_FONT_SCALE)) {
    throw new Error(`Column content does not fit at the minimum font scale (${MIN_FONT_SCALE})`);
  }

  let low = MIN_FONT_SCALE;
  let high = 1;
  if (columnFits(blocks, x, yTop, width, height, imageSource, high)) {
    low = high;
    while (high < MAX_FONT_SCALE) {
      high = Math.min(high * 2, MAX_FONT_SCALE);
      if (!columnFits(blocks, x, yTop, width, height, imageSource, high)) break;
      low = high;
      if (high === MAX_FONT_SCALE) return high;
    }
  }

  for (let step = 0; step < SCALE_SEARCH_STEPS; step++) {
    const scale = (low + high) / 2;
    if (columnFits(blocks, x, yTop, width, height, imageSource, scale)) low = scale;
    else high = scale;
  }
  return low;
}
