import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "../lib/api";
import "../styles/assets.css";

type Asset = { id: string; name: string; kind: string; mimeType: string; size: number; createdAt: string };
type Upload = { name: string; kind: "branding" | "image" | "qr"; file: FileList };
type Rename = { name: string };

function message(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "value" in error) {
    const value = error.value;
    if (value && typeof value === "object" && "error" in value && typeof value.error === "string") return value.error;
  }
  return fallback;
}

function AssetRow({ asset }: { asset: Asset }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const { register, handleSubmit, formState: { errors } } = useForm<Rename>({ defaultValues: { name: asset.name } });
  const rename = useMutation({
    mutationFn: async ({ name }: Rename) => {
      const response = await api.api.assets({ id: asset.id }).patch({ name });
      if (response.error) throw new Error(message(response.error, "Could not rename the image. Try again."));
    },
    onSuccess: () => { setEditing(false); client.invalidateQueries({ queryKey: ["assets"] }); },
  });
  const remove = useMutation({
    mutationFn: async () => {
      const response = await api.api.assets({ id: asset.id }).delete();
      if (response.error) throw new Error(message(response.error, "Could not remove the image. Try again."));
    },
    onSuccess: () => { setConfirming(false); client.invalidateQueries({ queryKey: ["assets"] }); },
  });
  return <li className="asset-row">
    <div className="asset-preview"><img src={`/api/assets/${asset.id}/image`} alt={asset.name} loading="lazy" /></div>
    <div className="asset-detail"><strong>{asset.name}</strong><span>{asset.kind === "qr" ? "QR" : asset.kind === "branding" ? "Branding" : "Image"} · {(asset.size / 1024).toFixed(0)} KB</span>
      {editing && <form className="asset-inline" onSubmit={handleSubmit((values) => rename.mutateAsync(values))}><label htmlFor={`rename-${asset.id}`}>Image name</label><div><input id={`rename-${asset.id}`} {...register("name", { required: "Enter a name.", maxLength: { value: 160, message: "Use 160 characters or fewer." } })} aria-invalid={!!errors.name} /><button disabled={rename.isPending} type="submit">{rename.isPending ? "Saving…" : "Save name"}</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div>{errors.name && <small role="alert">{errors.name.message}</small>}</form>}
      {confirming && <div className="asset-confirm"><p>Remove “{asset.name}”? Bulletins using this image may no longer generate until you select another asset.</p><button disabled={remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? "Removing…" : "Remove image"}</button><button onClick={() => setConfirming(false)}>Cancel</button></div>}
      {(rename.isError || remove.isError) && <p role="alert" className="error">{rename.error?.message || remove.error?.message}</p>}
    </div>
    <div className="asset-actions"><button onClick={() => { setEditing(true); setConfirming(false); }} disabled={editing}>Rename</button><button onClick={() => { setConfirming(true); setEditing(false); }} disabled={confirming}>Remove</button></div>
  </li>;
}

export function AssetLibrary() {
  const client = useQueryClient();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Upload>({ defaultValues: { kind: "image" } });
  const assets = useQuery({ queryKey: ["assets"], queryFn: async () => {
    const response = await api.api.assets.get();
    if (response.error || !response.data || !("assets" in response.data)) throw new Error(message(response.error, "Could not load images. Try again."));
    return response.data.assets as Asset[];
  }, retry: false });
  const upload = useMutation({
    mutationFn: async (values: Upload) => {
      const file = values.file[0];
      if (!file) throw new Error("Choose an image to upload.");
      if (file.size > 5 * 1024 * 1024) throw new Error("Image is too large. Choose a file under 5 MB.");
      const form = new FormData();
      form.set("file", file); form.set("name", values.name); form.set("kind", values.kind);
      const response = await api.api.assets.post(form);
      if (response.error) throw new Error(message(response.error, "Could not upload the image. Try again."));
    },
    onSuccess: () => { reset(); client.invalidateQueries({ queryKey: ["assets"] }); },
  });
  return <main className="workspace asset-library">
    <div className="workspace-heading"><div><h1>Images</h1><p>Reusable branding, images, and QR codes for bulletins.</p></div></div>
    <section className="asset-upload" aria-labelledby="asset-upload-title"><h2 id="asset-upload-title">Add an image</h2><p>PNG, JPEG, GIF, or WebP · up to 5 MB</p>
      <form onSubmit={handleSubmit((values) => upload.mutateAsync(values))}>
        <div className="asset-fields"><div><label htmlFor="asset-name">Name</label><input id="asset-name" placeholder="e.g. Campus logo" {...register("name", { required: "Enter a name.", maxLength: { value: 160, message: "Use 160 characters or fewer." } })} aria-invalid={!!errors.name} />{errors.name && <small role="alert">{errors.name.message}</small>}</div>
          <div><label htmlFor="asset-kind">Use</label><select id="asset-kind" {...register("kind")}><option value="image">Image</option><option value="branding">Branding</option><option value="qr">QR code</option></select></div>
          <div><label htmlFor="asset-file">Image file</label><input id="asset-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" {...register("file", { required: "Choose an image." })} aria-invalid={!!errors.file} />{errors.file && <small role="alert">{errors.file.message}</small>}</div></div>
        {upload.isError && <p role="alert" className="error">{upload.error.message}</p>}
        <button type="submit" className="primary" disabled={upload.isPending}>{upload.isPending ? "Uploading…" : "Upload image"}</button>
      </form>
    </section>
    <section className="asset-list" aria-labelledby="asset-list-title"><div className="asset-list-heading"><h2 id="asset-list-title">Library</h2>{assets.data && <span>{assets.data.length} {assets.data.length === 1 ? "image" : "images"}</span>}</div>
      {assets.isPending ? <p>Loading images…</p> : assets.isError ? <p role="alert" className="error">{assets.error.message} <button onClick={() => assets.refetch()}>Try again</button></p> : assets.data?.length ? <ul>{assets.data.map(asset => <AssetRow key={asset.id} asset={asset} />)}</ul> : <p>No images yet. Upload one to use it in a bulletin.</p>}
    </section>
  </main>;
}
