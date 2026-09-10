import PDFDocument from "pdfkit";
import {
  MAX_FONT_SCALE,
  MIN_FONT_SCALE,
  PAGE_H,
  PAGE_W,
  SCALE_SEARCH_STEPS,
} from "./constants";
import { renderColumn, type Doc } from "./render";
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

export function largestColumnScale(
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
