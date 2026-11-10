import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useFieldArray, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

type Part = { text: string; label?: string; style?: "chorus" };
type Song = { key: string; title: string; parts: Part[]; columns: 1 | 2 | null; scale: number | null };
type Fields = { key: string; title: string; parts: Part[]; columns: "" | "1" | "2"; scale: string };
const blank: Fields = { key: "", title: "", parts: [{ label: "Verse 1", text: "" }], columns: "", scale: "" };

function message(error: { status?: number } | null, fallback: string) {
  if (error?.status === 409) return "That song key is already in use. Choose another key.";
  if (error?.status === 404) return "This song no longer exists. Return to the list and select another.";
  if (error?.status === 401) return "Your session has expired. Sign in again to continue.";
  return fallback;
}

export function SongStore() {
  const [params, setParams] = useSearchParams();
  const selected = params.get("key");
  const creating = params.has("new");
  const [search, setSearch] = useState("");
  const client = useQueryClient();
  const songs = useQuery({
    queryKey: ["songs", search],
    queryFn: async () => {
      const result = await api.api.songs.get({ query: { search } });
      if (result.error || !result.data || !("songs" in result.data)) throw new Error(message(result.error, "Could not load songs. Try again."));
      return result.data.songs;
    },
    retry: false,
  });
  const detail = useQuery({
    queryKey: ["song", selected], enabled: !!selected, retry: false,
    queryFn: async () => {
      const result = await api.api.songs({ key: selected! }).get();
      if (result.error || !result.data || !("song" in result.data)) throw new Error(message(result.error, "Could not load this song. Try again."));
      return result.data.song;
    },
  });
  const { register, handleSubmit, control, reset, watch, formState: { errors, isDirty } } = useForm<Fields>({ defaultValues: blank });
  const { fields, append, move, remove } = useFieldArray({ control, name: "parts" });
  const key = watch("key");
  useEffect(() => {
    if (creating) reset(blank);
    else if (detail.data && detail.data.key === selected) reset({
      key: detail.data.key, title: detail.data.title, parts: detail.data.parts,
      columns: detail.data.columns ? String(detail.data.columns) as "1" | "2" : "",
      scale: detail.data.scale == null ? "" : String(detail.data.scale),
    });
  }, [creating, detail.data, selected, reset]);
  useEffect(() => {
    if (!isDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);
  const choose = (next: string) => {
    if (isDirty && !window.confirm("Discard your unsaved song changes?")) return;
    save.reset(); deletion.reset();
    setParams(next ? next === "new" ? { new: "1" } : { key: next } : {});
  };
  const save = useMutation({
    mutationFn: async (values: Fields) => {
      const body: Song = { key: values.key.trim(), title: values.title.trim(), parts: values.parts.map(part => ({
        text: part.text, ...(part.label ? { label: part.label } : {}), ...(part.style === "chorus" ? { style: "chorus" as const } : {}),
      })), columns: values.columns ? Number(values.columns) as 1 | 2 : null, scale: values.scale ? Number(values.scale) : null };
      const result = creating ? await api.api.songs.post(body) : await api.api.songs({ key: selected! }).put(body);
      if (result.error || !result.data || !("song" in result.data)) throw new Error(message(result.error, "Could not save this song. Try again."));
      return result.data.song;
    },
    onSuccess: async (song) => {
      reset({ key: song.key, title: song.title, parts: song.parts, columns: song.columns ? String(song.columns) as "1" | "2" : "", scale: song.scale == null ? "" : String(song.scale) });
      setParams({ key: song.key }, { replace: true });
      await client.invalidateQueries({ queryKey: ["songs"] });
      await client.invalidateQueries({ queryKey: ["song"] });
    },
  });
  const deletion = useMutation({
    mutationFn: async () => {
      const result = await api.api.songs({ key: selected! }).delete();
      if (result.error) throw new Error(message(result.error, "Could not delete this song. Try again."));
    },
    onSuccess: async () => {
      reset(blank); setParams({});
      await client.invalidateQueries({ queryKey: ["songs"] });
      await client.invalidateQueries({ queryKey: ["song"] });
    },
  });
  const active = creating || !!selected;
  return <main className="workspace songs-page">
    <nav className="library-nav" aria-label="Workspace"><Link to="/">Bulletins</Link><span aria-current="page">Song store</span></nav>
    <div className="workspace-heading"><div><h1>Song store</h1><p>Shared songs available for bulletin selection.</p></div><button className="primary" onClick={() => choose("new")}>Add song</button></div>
    <div className="song-layout">
      <section className="song-catalog" aria-label="Songs">
        <label htmlFor="song-search">Search songs</label><input id="song-search" type="search" placeholder="Key or title" value={search} onChange={event => setSearch(event.target.value)} />
        {songs.isPending ? <p>Loading songs…</p> : songs.isError ? <p role="alert" className="error">{songs.error.message} <button onClick={() => songs.refetch()}>Try again</button></p> : songs.data?.length ?
          <ul className="song-list">{songs.data.map(song => <li key={song.key}><button className={selected === song.key ? "selected" : ""} aria-current={selected === song.key ? "true" : undefined} onClick={() => choose(song.key)}><strong>{song.title}</strong><span>{song.key}</span></button></li>)}</ul> :
          <p className="catalog-empty">{search ? "No songs match your search." : "No songs yet. Add the first song to the store."}</p>}
      </section>
      <section className="song-editor" aria-label="Song editor">
        {!active ? <p>Select a song to edit, or add a song.</p> : selected && detail.isPending ? <p>Loading song…</p> : selected && detail.isError ? <p role="alert" className="error">{detail.error.message} <button onClick={() => detail.refetch()}>Try again</button></p> :
        <form onSubmit={handleSubmit(values => save.mutateAsync(values))}>
          <div className="editor-title"><div><h2>{creating ? "New song" : "Edit song"}</h2><p>{isDirty ? "Unsaved changes" : "Changes are saved to the shared store."}</p></div>{selected && <button type="button" onClick={() => {
            if (window.confirm(`Delete “${detail.data?.title}”? Bulletins using “${selected}” will keep the key but will no longer resolve until a song with that key is added again.`)) deletion.mutate();
          }} disabled={deletion.isPending || save.isPending} className="danger">Delete song</button>}</div>
          <label htmlFor="song-key">Song key</label><input id="song-key" {...register("key", { required: "Enter a song key.", validate: value => !!value.trim() || "Enter a song key." })} aria-invalid={!!errors.key} />{errors.key && <small role="alert">{errors.key.message}</small>}
          {selected && key !== selected && <p className="notice" role="status">Changing this key will not update older bulletins. They will keep the old key until you add a song under it or change their reference.</p>}
          <label htmlFor="song-title">Title</label><input id="song-title" {...register("title", { required: "Enter a title.", validate: value => !!value.trim() || "Enter a title." })} aria-invalid={!!errors.title} />{errors.title && <small role="alert">{errors.title.message}</small>}
          <div className="parts-heading"><h3>Song parts</h3><span>Use the controls to reorder parts.</span></div>
          {fields.map((field, index) => <div className="part" key={field.id}>
            <div className="part-top"><strong>Part {index + 1}</strong><div><button type="button" aria-label={`Move part ${index + 1} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>Up</button><button type="button" aria-label={`Move part ${index + 1} down`} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}>Down</button><button type="button" disabled={fields.length === 1} onClick={() => remove(index)}>Remove</button></div></div>
            <div className="part-fields"><div><label htmlFor={`part-label-${field.id}`}>Label</label><input id={`part-label-${field.id}`} placeholder="Verse 1, Chorus…" {...register(`parts.${index}.label`)} /></div><div><label htmlFor={`part-type-${field.id}`}>Type</label><select id={`part-type-${field.id}`} {...register(`parts.${index}.style`)}><option value="">Verse</option><option value="chorus">Chorus</option></select></div></div>
            <label htmlFor={`part-text-${field.id}`}>Text</label><textarea id={`part-text-${field.id}`} rows={4} {...register(`parts.${index}.text`, { required: "Enter text for this part.", validate: value => !!value.trim() || "Enter text for this part." })} aria-invalid={!!errors.parts?.[index]?.text} />{errors.parts?.[index]?.text && <small role="alert">{errors.parts[index]?.text?.message}</small>}
          </div>)}
          <button className="add-part" type="button" onClick={() => append({ label: `Verse ${fields.length + 1}`, text: "" })}>Add part</button>
          <h3>Layout defaults</h3><p className="field-hint">Optional; individual bulletin blocks may override these.</p>
          <div className="part-fields"><div><label htmlFor="song-columns">Columns</label><select id="song-columns" {...register("columns")}><option value="">No default</option><option value="1">1 column</option><option value="2">2 columns</option></select></div><div><label htmlFor="song-scale">Scale</label><input id="song-scale" type="number" step="any" min="0.01" placeholder="No default" {...register("scale", { validate: value => !value || Number(value) > 0 || "Scale must be greater than zero." })} aria-invalid={!!errors.scale} />{errors.scale && <small role="alert">{errors.scale.message}</small>}</div></div>
          {save.isError && <p role="alert" className="error">{save.error.message}</p>}{deletion.isError && <p role="alert" className="error">{deletion.error.message}</p>}
          <div className="form-actions"><button className="primary" type="submit" disabled={save.isPending || deletion.isPending}>{save.isPending ? "Saving…" : creating ? "Add song" : "Save song"}</button><button type="button" onClick={() => choose("")}>Cancel</button></div>
        </form>}
      </section>
    </div>
  </main>;
}
