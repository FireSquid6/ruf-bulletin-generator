import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export type Block = {
  type: string;
  role?: string;
  assetId?: string;
  title?: string;
  reference?: string;
  text?: string;
  songKey?: string;
  items?: Array<{ text?: string; name?: string; detail?: string; caption?: string; assetId?: string }>;
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

function AssetPicker({ value, onChange, kind }: { value?: string; onChange: (value: string) => void; kind: "branding" | "qr" | "image" }) {
  const assets = useQuery({ queryKey: ["assets"], queryFn: async () => {
    const response = await api.api.assets.get();
    if (response.error || !response.data || !("assets" in response.data)) throw new Error("Could not load images. Try again.");
    return response.data.assets;
  }, retry: false });
  if (assets.isPending) return <p>Loading images…</p>;
  if (assets.isError) return <p role="alert" className="error">{assets.error.message} <button type="button" onClick={() => assets.refetch()}>Try again</button></p>;
  const choices = (assets.data ?? []).filter((asset) => asset.kind === kind || kind === "branding" && asset.kind === "image");
  return <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}><option value="">No image selected</option>{value && !choices.some((asset) => asset.id === value) && <option value={value}>Unavailable image ({value})</option>}{choices.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select>;
}

function GroupedItems({ area, index, type, form }: { area: Area; index: number; type: string; form: Form }) {
  const name = `composition.${area}.${index}.items` as const;
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name });
  const itemName = type === "contacts" ? "contact" : type === "qr" ? "QR code" : "announcement";
  return <div className="grouped-items">{fields.map((field, position) => <div className="grouped-item" key={field.id}>
    {type === "contacts" ? <><label>Name<input {...form.register(`${name}.${position}.name`)} /></label><label>Detail<input {...form.register(`${name}.${position}.detail`)} /></label></> : type === "qr" ? <><label>Caption<input {...form.register(`${name}.${position}.caption`)} /></label><label>QR image<Controller name={`${name}.${position}.assetId`} control={form.control} render={({ field: image }) => <AssetPicker kind="qr" value={image.value} onChange={image.onChange} />} /></label></> : <label>Announcement<input {...form.register(`${name}.${position}.text`)} /></label>}
    <div className="block-actions"><button type="button" aria-label={`Move ${itemName} ${position + 1} up`} disabled={position === 0} onClick={() => move(position, position - 1)}>Up</button><button type="button" aria-label={`Move ${itemName} ${position + 1} down`} disabled={position === fields.length - 1} onClick={() => move(position, position + 1)}>Down</button><button type="button" aria-label={`Remove ${itemName} ${position + 1}`} onClick={() => remove(position)}>Remove item</button></div>
  </div>)}<button type="button" onClick={() => append(type === "contacts" ? { name: "", detail: "" } : type === "qr" ? { caption: "", assetId: "" } : { text: "" })}>Add {itemName}</button></div>;
}

function BlockFields({ block, area, index, form }: { block: Block; area: Area; index: number; form: Form }) {
  const prefix = `composition.${area}.${index}` as const;
  return <>
    {(block.type === "branding" || block.type === "image") && <label>Image asset<Controller name={`${prefix}.assetId`} control={form.control} render={({ field }) => <AssetPicker kind={block.type === "branding" ? "branding" : "image"} value={field.value as string | undefined} onChange={field.onChange} />} /></label>}
    {(block.type === "announcements" || block.type === "heading") && <label>Heading<input {...form.register(`${prefix}.title`)} /></label>}
    {block.type === "text" && <label>Text<textarea rows={3} {...form.register(`${prefix}.text`)} /></label>}
    {block.type === "scripture" && <><label>Role<select {...form.register(`${prefix}.role`)}><option value="sermon">Sermon passage</option><option value="reading">Scripture reading</option></select></label><label>Reference<input {...form.register(`${prefix}.reference`)} /></label><label>Passage text<textarea rows={4} {...form.register(`${prefix}.text`)} /></label></>}
    {block.type === "song" && <label>Song key<input {...form.register(`${prefix}.songKey`)} placeholder="Choose a song later" /></label>}
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
      {list.fields.map((block, index) => <div className="block-edit" key={block.id}>
        <div className="block-title"><strong>{index + 1}. {blockLabel(block)}</strong><div className="block-order"><button type="button" aria-label={`Move ${blockLabel(block)} ${index + 1} up in ${area === "cover" ? "cover" : "reading order"}`} disabled={index === 0} onClick={() => list.move(index, index - 1)}>Up</button><button type="button" aria-label={`Move ${blockLabel(block)} ${index + 1} down in ${area === "cover" ? "cover" : "reading order"}`} disabled={index === list.fields.length - 1} onClick={() => list.move(index, index + 1)}>Down</button></div></div>
        <BlockFields block={block} area={area} index={index} form={form} />
        <div className="block-actions"><button type="button" onClick={() => moveBetween(area, index)}>Move to {area === "cover" ? "reading order" : "cover"}</button><button type="button" aria-label={`Remove ${blockLabel(block)} ${index + 1} from ${area === "cover" ? "cover" : "reading order"}`} onClick={() => list.remove(index)}>Remove</button></div>
      </div>)}
      <label className="add-block">Add block to {area === "cover" ? "cover" : "reading order"}<select value="" onChange={(event) => { if (event.target.value) list.append(newBlock(event.target.value)); }}><option value="">Choose a block…</option>{blockTypes.map((type) => <option key={type} value={type}>{blockNames[type]}</option>)}</select></label>
    </section>;
  })}</>;
}
