import fs from "node:fs";
import path from "node:path";
import YAML from "js-yaml";
import PDFDocument from "pdfkit";
import {
  DEFAULT_GUTTER_MM,
  DEFAULT_HORIZONTAL_MARGIN_MM,
  DEFAULT_VERTICAL_MARGIN_MM,
  MM,
  PAGE_H,
  PAGE_W,
} from "./constants";
import { arrangeFoldedPages, largestColumnScale, planFoldedFlow } from "./layout";
import { resolvePath } from "./paths";
import { renderColumn, type Doc } from "./render";
import { validateSpec } from "./validation";

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
    doc.save()
      .strokeColor("#c9c9c9")
      .lineWidth(0.5)
      .rect(x, verticalMargin, width, contentHeight)
      .stroke()
      .restore();
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
      if (weights.length !== columns.length || weights.some((weight) => Number(weight) <= 0)) {
        throw new Error("column_weights must be positive and match the number of columns");
      }
      const availableWidth = PAGE_W - 2 * horizontalMargin - gutter * (columns.length - 1);
      const totalWeight = weights.reduce((sum, weight) => sum + Number(weight), 0);
      const widths = weights.map((weight) => (availableWidth * Number(weight)) / totalWeight);

      let x = horizontalMargin;
      for (const [index, blocks] of columns.entries()) {
        const width = widths[index];
        const scale = largestColumnScale(
          blocks,
          x,
          verticalMargin,
          width,
          contentHeight,
          yamlDir,
        );
        renderColumn(doc, blocks, x, verticalMargin, width, contentHeight, yamlDir, scale);
        drawGuide(x, width);
        x += width + gutter;
      }
    });
  }

  doc.end();
  await new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return destination;
}
