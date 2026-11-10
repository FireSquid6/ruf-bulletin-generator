import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api";
import { AssetPicker } from "./AssetPicker";
import { GroupedItems } from "./GroupedItems";

export type Block = {
  type: string;
  role?: string;
  assetId?: string;
  title?: string;
  reference?: string;
  text?: string;
  songKey?: string;
  items?: Array<{ title?: string; text?: string; name?: string; detail?: string; caption?: string; assetId?: string; size_mm?: number }>;
};
export type Composition = { cover: Block[]; flow: Block[] };
export type DraftForm = { gatheringDate: string; composition: Composition };
type Area = "cover" | "flow";
type Form = UseFormReturn<DraftForm>;

const blockTypes = ["branding", "announcements", "contacts", "sermon", "reading", "song", "heading", "text", "image", "spacer", "qr"] as const;
export const blockNames: Record<string, string> = { branding: "Branding", announcements: "Announcements", contacts: "Contacts", sermon: "Sermon passage", reading: "Scripture reading", song: "Song", heading: "Heading", text: "Text", image: "Image", spacer: "Spacer", qr: "QR codes" };
export function blockLabel(block: Block) {
  return block.type === "scripture" ? block.role === "sermon" ? "Sermon passage" : "Scripture reading" : blockNames[block.type] ?? block.type;
}
function newBlock(type: string): Block {
  switch (type) {
    case "sermon": case "reading": return { type: "scripture", role: type, reference: "", text: "" };
    case "song": return { type, songKey: "" };
    case "branding": case "image": return { type, assetId: "" };
    case "announcements": return { type, title: "", items: [] };
    case "contacts": case "qr": return { type, items: [] };
    case "heading": return { type, title: "" };
    case "text": return { type, text: "" };
    default: return { type };
  }
}

function SongPicker({ value, onChange }: { value?: string; onChange: (value: string) => void }) {
  const [search, setSearch] = useState("");
  const songs = useQuery({ queryKey: ["songs", ""], queryFn: async () => {
    const response = await api.api.songs.get({ query: { search: "" } });
    if (response.error || !response.data || !("songs" in response.data)) throw new Error("Could not load songs. You can still enter a key below.");
    return response.data.songs;
  }, retry: false });
  const choices = songs.data ?? [];
  const missing = !!value && !choices.some((song) => song.key === value);
  const matches = choices.filter((song) => song.key === value || `${song.key} ${song.title}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="song-picker">
    {songs.isPending ? <p>Loading songs…</p> : songs.isError ? <p role="alert" className="error">{songs.error.message} <button type="button" onClick={() => songs.refetch()}>Try again</button></p> : <>
      {missing && <p className="field-warning" role="status">Song key “{value}” is not in the song store. This draft can still be saved.</p>}
      <label>Find a song<input aria-label="Find a song" type="search" value={search} placeholder="Search by key or title" onChange={(event) => setSearch(event.target.value)} /></label>
      <label>Select song<select aria-label="Select song" value={value && !missing ? value : ""} onChange={(event) => onChange(event.target.value)}><option value="">{value && missing ? "Keep missing key" : "Choose a song…"}</option>{matches.map((song) => <option key={song.key} value={song.key}>{song.title} · {song.key}</option>)}</select></label>
    </>}
    <label>Song key<input aria-label="Song key" value={value ?? ""} onChange={(event) => onChange(event.target.value)} placeholder="Enter a key or select a song" /></label>
  </div>;
}

function BlockFields({ block, area, index, form }: { block: Block; area: Area; index: number; form: Form }) {
  const prefix = `composition.${area}.${index}` as const;
  return <>
    {(block.type === "branding" || block.type === "image") && <label>Image asset<Controller name={`${prefix}.assetId`} control={form.control} render={({ field }) => <AssetPicker kind={block.type === "branding" ? "branding" : "image"} value={field.value as string | undefined} onChange={field.onChange} />} /></label>}
    {(block.type === "announcements" || block.type === "heading") && <label>Heading<input aria-label={`${blockLabel(block)} ${index + 1} heading`} {...form.register(`${prefix}.title`)} /></label>}
    {block.type === "text" && <label>Text<textarea aria-label={`Text block ${index + 1}`} rows={3} {...form.register(`${prefix}.text`)} /></label>}
    {block.type === "scripture" && <><label>Role<select aria-label={`Passage ${index + 1} role`} {...form.register(`${prefix}.role`)}><option value="sermon">Sermon passage</option><option value="reading">Scripture reading</option></select></label><label>Reference<input aria-label={`Passage ${index + 1} reference`} {...form.register(`${prefix}.reference`)} /></label><label>Passage text<textarea aria-label={`Passage ${index + 1} text`} rows={4} {...form.register(`${prefix}.text`)} /></label></>}
    {block.type === "song" && <Controller name={`${prefix}.songKey`} control={form.control} render={({ field }) => <SongPicker value={field.value as string | undefined} onChange={field.onChange} />} />}
    {(block.type === "announcements" || block.type === "contacts" || block.type === "qr") && <GroupedItems area={area} index={index} type={block.type} form={form} />}
    {block.type === "spacer" && <p className="field-note">A blank space in the composition.</p>}
  </>;
}

export function BlockEditor({ form }: { form: Form }) {
  const cover = useFieldArray({ control: form.control, name: "composition.cover" });
  const flow = useFieldArray({ control: form.control, name: "composition.flow" });
  function moveBetween(from: Area, index: number) {
    const destination = from === "cover" ? flow : cover;
    const source = from === "cover" ? cover : flow;
    const block = form.getValues(`composition.${from}.${index}`);
    source.remove(index);
    destination.append(block);
  }
  return <>{(["cover", "flow"] as const).map((area) => {
    const list = area === "cover" ? cover : flow;
    return <section className="block-group" key={area} aria-label={area === "cover" ? "Cover blocks" : "Reading-order blocks"}>
      <h2>{area === "cover" ? "Cover" : "Reading order"}</h2><p>{area === "cover" ? "The right-hand outside panel" : "The remaining content, in sequence"}</p>
      {list.fields.length === 0 && <p className="block-empty">No blocks yet. Add a block below or move one here.</p>}
      {list.fields.map((block, index) => <div className="block-edit" id={`block-${area}-${index}`} tabIndex={-1} key={block.id}>
        <div className="block-title"><strong>{index + 1}. {blockLabel(block)}</strong><div className="block-order"><button type="button" aria-label={`Move ${blockLabel(block)} ${index + 1} up in ${area === "cover" ? "cover" : "reading order"}`} disabled={index === 0} onClick={() => list.move(index, index - 1)}>Up</button><button type="button" aria-label={`Move ${blockLabel(block)} ${index + 1} down in ${area === "cover" ? "cover" : "reading order"}`} disabled={index === list.fields.length - 1} onClick={() => list.move(index, index + 1)}>Down</button></div></div>
        <BlockFields key={`${area}.${index}.${block.id}`} block={block} area={area} index={index} form={form} />
        <div className="block-actions"><button type="button" onClick={() => moveBetween(area, index)}>Move to {area === "cover" ? "reading order" : "cover"}</button><button type="button" aria-label={`Remove ${blockLabel(block)} ${index + 1} from ${area === "cover" ? "cover" : "reading order"}`} onClick={() => list.remove(index)}>Remove</button></div>
      </div>)}
      <label className="add-block">Add block to {area === "cover" ? "cover" : "reading order"}<select value="" onChange={(event) => { if (event.target.value) list.append(newBlock(event.target.value)); }}><option value="">Choose a block…</option>{blockTypes.map((type) => <option key={type} value={type}>{blockNames[type]}</option>)}</select></label>
    </section>;
  })}</>;
}
