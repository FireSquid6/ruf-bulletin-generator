import fs from "node:fs";
import YAML from "js-yaml";
import type { Block, SongPart, SongStore, Spec, StoredSong } from "./types";

function isMapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateSongPart(part: unknown, songKey: string, partIndex: number): asserts part is SongPart {
  if (!isMapping(part) || typeof part.text !== "string" || part.text.length === 0) {
    throw new Error(`Song '${songKey}' part ${partIndex + 1} requires non-empty text`);
  }
  if (part.label !== undefined && typeof part.label !== "string") {
    throw new Error(`Song '${songKey}' part ${partIndex + 1} label must be a string`);
  }
  if (part.style !== undefined && part.style !== "chorus") {
    throw new Error(`Song '${songKey}' part ${partIndex + 1} has unsupported style '${String(part.style)}'`);
  }
}

function validateStoredSong(song: unknown, songKey: string): asserts song is StoredSong {
  if (!isMapping(song)) throw new Error(`Song '${songKey}' must be a mapping`);
  if (typeof song.title !== "string" || song.title.length === 0) {
    throw new Error(`Song '${songKey}' requires a non-empty title`);
  }
  if (!Array.isArray(song.parts) || song.parts.length === 0) {
    throw new Error(`Song '${songKey}' requires a non-empty parts list`);
  }
  song.parts.forEach((part, index) => validateSongPart(part, songKey, index));
  if (song.columns !== undefined && song.columns !== 1 && song.columns !== 2) {
    throw new Error(`Song '${songKey}' columns must be 1 or 2`);
  }
  if (
    song.scale !== undefined &&
    (typeof song.scale !== "number" || !Number.isFinite(song.scale) || song.scale <= 0)
  ) {
    throw new Error(`Song '${songKey}' scale must be a positive number`);
  }
}

export function validateSongStore(store: unknown): asserts store is SongStore {
  if (!isMapping(store)) throw new Error("The song store YAML root must be a mapping");
  if (!isMapping(store.songs)) throw new Error("The song store requires a 'songs' mapping");

  for (const [songKey, song] of Object.entries(store.songs)) {
    if (songKey.length === 0) throw new Error("Song store keys must not be empty");
    validateStoredSong(song, songKey);
  }
}

export function loadSongStore(storePath: string): SongStore {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Unable to read song store '${storePath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let store: unknown;
  try {
    store = YAML.load(raw);
  } catch (error) {
    throw new Error(
      `Unable to parse song store '${storePath}': ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    validateSongStore(store);
  } catch (error) {
    throw new Error(`Invalid song store '${storePath}': ${error instanceof Error ? error.message : String(error)}`);
  }
  return store;
}

export function hasSongReferences(spec: Spec): boolean {
  const hasReference = (blocks: Block[]) =>
    blocks.some((block) => block.type === "song" && block.song_ref !== undefined);
  return Boolean(
    spec.cover?.some((block) => block.type === "song" && block.song_ref !== undefined) ||
    spec.flow?.some((block) => block.type === "song" && block.song_ref !== undefined) ||
    spec.pages?.some((page) => page.columns.some(hasReference))
  );
}

function resolveBlocks(blocks: Block[], store: SongStore, location: string): Block[] {
  return blocks.map((block, index) => {
    if (block.type !== "song" || block.song_ref === undefined) return block;
    if (typeof block.song_ref !== "string" || block.song_ref.length === 0) {
      throw new Error(`${location} block ${index + 1} has an invalid song_ref`);
    }
    if (block.title !== undefined || block.parts !== undefined) {
      throw new Error(`${location} block ${index + 1} cannot combine song_ref with title or parts`);
    }

    const song = Object.hasOwn(store.songs, block.song_ref) ? store.songs[block.song_ref] : undefined;
    if (!song) {
      throw new Error(`Song '${block.song_ref}' referenced by ${location} block ${index + 1} was not found in the song store`);
    }
    const columns = block.columns ?? song.columns;
    const scale = block.scale ?? song.scale;
    return {
      type: "song",
      title: song.title,
      parts: song.parts,
      ...(columns === undefined ? {} : { columns }),
      ...(scale === undefined ? {} : { scale }),
    };
  });
}

export function resolveSongReferences(spec: Spec, store: SongStore): Spec {
  return {
    ...spec,
    cover: spec.cover && resolveBlocks(spec.cover, store, "Cover"),
    flow: spec.flow && resolveBlocks(spec.flow, store, "Flow"),
    pages: spec.pages?.map((page, pageIndex) => ({
      ...page,
      columns: page.columns.map((column, columnIndex) =>
        resolveBlocks(column, store, `Page ${pageIndex + 1}, column ${columnIndex + 1}`),
      ),
    })),
  };
}
