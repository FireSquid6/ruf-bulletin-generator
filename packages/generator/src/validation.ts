import { BLOCK_TYPES } from "./constants";
import type { Block, Spec } from "./types";

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
