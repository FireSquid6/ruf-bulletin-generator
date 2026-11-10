import { Controller, useFieldArray, type UseFormReturn } from "react-hook-form";
import { AssetPicker } from "./AssetPicker";
import type { DraftForm } from "./BlockEditor";

type Area = "cover" | "flow";

export function GroupedItems({ area, index, type, form }: { area: Area; index: number; type: "announcements" | "contacts" | "qr"; form: UseFormReturn<DraftForm> }) {
  const name = `composition.${area}.${index}.items` as const;
  const { fields, append, remove, move } = useFieldArray({ control: form.control, name });
  const itemName = type === "contacts" ? "contact" : type === "qr" ? "QR code" : "announcement";
  return <div className="grouped-items">{fields.map((field, position) => <div className="grouped-item" key={field.id}>
    {type === "announcements" ? <>
      <label>Title<input aria-label={`Announcement ${position + 1} title`} {...form.register(`${name}.${position}.title`)} /></label>
      <label>Text<textarea aria-label={`Announcement ${position + 1} text`} rows={3} {...form.register(`${name}.${position}.text`)} /></label>
    </> : type === "contacts" ? <>
      <label>Name<input aria-label={`Contact ${position + 1} name`} {...form.register(`${name}.${position}.name`)} /></label>
      <label>Detail<input aria-label={`Contact ${position + 1} detail`} {...form.register(`${name}.${position}.detail`)} /></label>
    </> : <>
      <label>Caption<input aria-label={`QR code ${position + 1} caption`} {...form.register(`${name}.${position}.caption`)} /></label>
      <label>Size (mm)<input aria-label={`QR code ${position + 1} size (mm)`} type="number" step="any" placeholder="Default: 28" {...form.register(`${name}.${position}.size_mm`, { setValueAs: (value: string) => value === "" ? undefined : Number(value) })} /></label>
      <label>QR image<Controller name={`${name}.${position}.assetId`} control={form.control} render={({ field: image }) => <AssetPicker kind="qr" value={image.value as string | undefined} onChange={image.onChange} />} /></label>
    </>}
    <div className="block-actions"><button type="button" aria-label={`Move ${itemName} ${position + 1} up`} disabled={position === 0} onClick={() => move(position, position - 1)}>Up</button><button type="button" aria-label={`Move ${itemName} ${position + 1} down`} disabled={position === fields.length - 1} onClick={() => move(position, position + 1)}>Down</button><button type="button" aria-label={`Remove ${itemName} ${position + 1}`} onClick={() => remove(position)}>Remove item</button></div>
  </div>)}<button type="button" onClick={() => append(type === "contacts" ? { name: "", detail: "" } : type === "qr" ? { caption: "", assetId: "" } : { title: "", text: "" })}>Add {itemName}</button></div>;
}
