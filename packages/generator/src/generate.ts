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
import { renderColumn, type Doc, type ImageSource } from "./render";
import { hasSongReferences, loadSongStore, resolveSongReferences, validateSongStore } from "./song-store";
import type { SongStore, Spec } from "./types";
import { validateSpec } from "./validation";

export async function generate(
  yamlPath: string,
  outputOverride?: string,
  debug = false,
  storePath?: string,
): Promise<string> {
  const raw = fs.readFileSync(yamlPath, "utf-8");
  const parsedSpec = YAML.load(raw) as unknown;
  validateSpec(parsedSpec);
  let spec: Spec = parsedSpec;

  if (storePath !== undefined || hasSongReferences(spec)) {
    const resolvedStorePath = path.resolve(storePath ?? "store/song-store.yaml");
    spec = resolveSongReferences(spec, loadSongStore(resolvedStorePath));
  }

  const yamlDir = path.dirname(path.resolve(yamlPath));
  const configuredOutput = spec.output ?? "bulletin.pdf";
  const destination = outputOverride ?? resolvePath(configuredOutput, yamlDir);
  const bytes = await renderDocument(spec, yamlDir, debug);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes);
  return destination;
}

export interface RenderPdfOptions {
  /** Current song-store contents, supplied by the caller rather than loaded from disk. */
  songStore?: SongStore;
  /** Image bytes keyed by the path/key in each branding, image or QR block. */
  assets?: Readonly<Record<string, Buffer>>;
  debug?: boolean;
}

/** Render PDF bytes without reading YAML, looking up assets on disk, or writing an output file. */
export async function renderPdf(spec: Spec, options: RenderPdfOptions = {}): Promise<Buffer> {
  validateSpec(spec);
  let resolved = spec;
  if (options.songStore !== undefined) {
    validateSongStore(options.songStore);
    resolved = resolveSongReferences(spec, options.songStore);
  } else if (hasSongReferences(spec)) {
    throw new Error("A song store is required to render song references");
  }
  const imageSource: ImageSource = (key) => {
    const image = options.assets && Object.hasOwn(options.assets, key) ? options.assets[key] : undefined;
    if (!Buffer.isBuffer(image)) throw new Error(`Image '${key}' is not available in the supplied assets`);
    return image;
  };
  return renderDocument(resolved, imageSource, options.debug ?? false);
}

async function renderDocument(spec: Spec, imageSource: ImageSource, debug: boolean): Promise<Buffer> {

  const horizontalMargin = Number(
    spec.layout?.horizontal_margin_mm ?? spec.layout?.margin_mm ?? DEFAULT_HORIZONTAL_MARGIN_MM,
  ) * MM;
  const verticalMargin = Number(
    spec.layout?.vertical_margin_mm ?? spec.layout?.margin_mm ?? DEFAULT_VERTICAL_MARGIN_MM,
  ) * MM;
  const gutter = Number(spec.layout?.gutter_mm ?? DEFAULT_GUTTER_MM) * MM;
  const contentHeight = PAGE_H - 2 * verticalMargin;

  const metadata = spec.metadata ?? {};
  // A dated persisted bulletin must yield identical bytes for preview and download.
  const creationDate = metadata.date && /^\d{4}-\d{2}-\d{2}$/.test(metadata.date)
    ? new Date(`${metadata.date}T00:00:00Z`) : undefined;
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, compress: true,
    ...(creationDate ? { info: { CreationDate: creationDate } } : {}),
  }) as Doc;
  doc.info.Title = metadata.title ?? "RUF Bulletin";
  doc.info.Author = metadata.author ?? "Reformed University Fellowship";
  doc.info.Subject = metadata.subject ?? "Weekly bulletin";
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

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
      imageSource,
    );
    const pages = arrangeFoldedPages(foldedCover, plan.columns);

    renderColumn(doc, pages[0][0], leftX, verticalMargin, width, contentHeight, imageSource, plan.scale);
    renderColumn(doc, pages[0][1], rightX, verticalMargin, width, contentHeight, imageSource, plan.scale);
    drawGuide(leftX, width);
    drawGuide(rightX, width);

    doc.addPage();
    renderColumn(doc, pages[1][0], leftX, verticalMargin, width, contentHeight, imageSource, plan.scale);
    renderColumn(doc, pages[1][1], rightX, verticalMargin, width, contentHeight, imageSource, plan.scale);
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
          imageSource,
        );
        renderColumn(doc, blocks, x, verticalMargin, width, contentHeight, imageSource, scale);
        drawGuide(x, width);
        x += width + gutter;
      }
    });
  }

  doc.end();
  return result;
}
