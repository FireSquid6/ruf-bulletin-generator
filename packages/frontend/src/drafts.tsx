import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFieldArray, useForm } from "react-hook-form";
import { api } from "./api";

type Block = { type: string; role?: string; asset?: string; title?: string; reference?: string; text?: string; songKey?: string; items?: Array<{ text?: string; name?: string; detail?: string; caption?: string; asset?: string }> };
type Composition = { cover: Block[]; flow: Block[] };
type Draft = { id: string; gatheringDate: string; revision: number; composition: Composition };
type DraftForm = { gatheringDate: string; composition: Composition };

function resultError(result: { error: unknown }, fallback: string): never {
  const value = (result.error as { value?: { error?: string } } | null)?.value;
  throw new Error(value?.error ?? fallback);
}

function CreateDraft() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [date, setDate] = useState("");
  const create = useMutation({ mutationFn: async () => {
    const response = await api.api.bulletins.post({ gatheringDate: date });
    if (response.error || !response.data || !("id" in response.data)) return resultError(response, "Could not create bulletin. Try again.");
    return response.data.id;
  }, onSuccess: async (id) => { await client.invalidateQueries({ queryKey: ["bulletins"] }); navigate(`/bulletins/${id}`); } });
  return <><form className="draft-toolbar" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}><div><label htmlFor="new-date">Gathering date</label><input id="new-date" type="date" required value={date} onChange={(event) => setDate(event.target.value)} /></div><button type="submit" className="primary" disabled={!date || create.isPending}>{create.isPending ? "Creating…" : "Create draft"}</button></form>{create.isError && <p role="alert" className="error">{create.error.message}</p>}</>;
}

export function NewDraft() {
  return <main className="workspace"><Link to="/">Back to bulletins</Link><h1 className="new-heading">New bulletin</h1><p className="new-description">Choose a gathering date. The starter is yours to edit, including the logo.</p><CreateDraft /></main>;
}

export function BulletinIndex() {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; gatheringDate: string } | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (!deleting) return; cancelButton.current?.focus(); const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDeleting(null); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [deleting]);
  const list = useQuery({ queryKey: ["bulletins", search], queryFn: async () => {
    const response = await api.api.bulletins.get({ query: search ? { date: search } : {} });
    if (response.error || !response.data || !("bulletins" in response.data)) return resultError(response, "Could not load bulletins. Try again.");
    return response.data.bulletins;
  }, retry: false });
  const remove = useMutation({ mutationFn: async (id: string) => {
    const response = await api.api.bulletins({ id }).delete();
    if (response.error) return resultError(response, "Could not delete bulletin. Try again.");
  }, onSuccess: async () => { setDeleting(null); await client.invalidateQueries({ queryKey: ["bulletins"] }); } });

  return <main className="workspace">
    <div className="workspace-heading"><div><h1>Bulletins</h1><p>Saved drafts by gathering date</p></div><Link className="button-link" to="/bulletins/new">New bulletin</Link></div>
    <div className="search-row"><label htmlFor="find-date">Find by date</label><input id="find-date" type="date" value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button onClick={() => setSearch("")}>Clear</button>}</div>
    {list.isPending ? <p>Loading drafts…</p> : list.isError ? <p role="alert" className="error">{list.error.message} <button onClick={() => list.refetch()}>Try again</button></p> : list.data?.length === 0 ?
      <section className="empty"><h2>{search ? "No draft for that date" : "No bulletins yet"}</h2><p>{search ? "Choose another date or clear the filter." : "Choose a gathering date to start a folded bulletin with blank weekly content."}</p></section> :
      <ul className="bulletin-list">{list.data?.map((item) => <li key={item.id}><Link to={`/bulletins/${item.id}`}><strong>{item.gatheringDate}</strong><span>Draft · Revision {item.revision}</span></Link><button onClick={() => setDeleting(item)}>Delete</button></li>)}</ul>}
    {deleting && <div className="dialog-scrim"><div className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-detail"><h2 id="delete-title">Delete this bulletin?</h2><p id="delete-detail">The draft for {deleting.gatheringDate} will be permanently removed.</p>{remove.isError && <p role="alert" className="error">{remove.error.message}</p>}<div className="dialog-actions"><button ref={cancelButton} disabled={remove.isPending} onClick={() => setDeleting(null)}>Cancel</button><button className="danger" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>{remove.isPending ? "Deleting…" : "Delete bulletin"}</button></div></div></div>}
  </main>;
}

const blockNames: Record<string, string> = { branding: "RUF logo", announcements: "Announcements", contacts: "Contacts", scripture: "Passage", song: "Song", heading: "Heading", text: "Text", spacer: "Spacer", qr: "QR codes" };
function BlockList({ area, control, register, getValues, setValue }: { area: "cover" | "flow"; control: ReturnType<typeof useForm<DraftForm>>["control"]; register: ReturnType<typeof useForm<DraftForm>>["register"]; getValues: ReturnType<typeof useForm<DraftForm>>["getValues"]; setValue: ReturnType<typeof useForm<DraftForm>>["setValue"] }) {
  const { fields, append, remove, move } = useFieldArray({ control, name: `composition.${area}` });
  const other = area === "cover" ? "flow" : "cover";
  return <section className="block-group"><h2>{area === "cover" ? "Cover" : "Reading order"}</h2><p>{area === "cover" ? "The right-hand outside panel" : "The remaining panels, in sequence"}</p>
    {fields.map((field, index) => { const prefix = `composition.${area}.${index}` as const; return <div className="block-edit" key={field.id}><div className="block-title"><strong>{blockNames[field.type] ?? field.type}</strong><div><button type="button" aria-label={`Move ${field.type} up`} disabled={index === 0} onClick={() => move(index, index - 1)}>Up</button><button type="button" aria-label={`Move ${field.type} down`} disabled={index === fields.length - 1} onClick={() => move(index, index + 1)}>Down</button></div></div>
      {field.type === "branding" && <>{field.asset === "ruf-baylor-logo.png" && <img className="logo-thumb" src="/ruf-baylor-logo.png" alt="RUF Baylor logo" />}<label>Image asset<input {...register(`${prefix}.asset`)} placeholder="Asset name" /></label></>}
      {(field.type === "announcements" || field.type === "heading" || field.type === "text") && <label>{field.type === "text" ? "Text" : "Heading"}<input {...register(`${prefix}.${field.type === "text" ? "text" : "title"}`)} /></label>}
      {field.type === "scripture" && <><label>Role<select {...register(`${prefix}.role`)}><option value="sermon">Sermon passage</option><option value="reading">Scripture reading</option></select></label><label>Reference<input {...register(`${prefix}.reference`)} /></label><label>Passage text<textarea rows={4} {...register(`${prefix}.text`)} /></label></>}
      {field.type === "song" && <label>Song key<input {...register(`${prefix}.songKey`)} placeholder="Choose a song later" /></label>}
      {(field.type === "announcements" || field.type === "contacts" || field.type === "qr") && <GroupedItems area={area} index={index} type={field.type} control={control} register={register} />}
      <div className="block-actions"><button type="button" onClick={() => { const block = getValues(prefix); remove(index); setValue(`composition.${other}`, [...getValues(`composition.${other}`), block], { shouldDirty: true }); }}>Move to {other === "cover" ? "cover" : "reading order"}</button><button type="button" onClick={() => remove(index)}>Remove</button></div></div>; })}
    <label className="add-block">Add block<select value="" onChange={(event) => { const type = event.target.value; if (type) append(type === "scripture" ? { type, role: "reading", reference: "", text: "" } : type === "song" ? { type, songKey: "" } : type === "branding" ? { type, asset: "ruf-baylor-logo.png" } : type === "announcements" || type === "contacts" ? { type, items: [] } : { type, text: "" }); }}><option value="">Choose a block…</option>{["branding", "announcements", "contacts", "scripture", "song", "heading", "text", "spacer", "qr"].map((type) => <option key={type} value={type}>{blockNames[type]}</option>)}</select></label>
  </section>;
}
function GroupedItems({ area, index, type, control, register }: { area: "cover" | "flow"; index: number; type: string; control: ReturnType<typeof useForm<DraftForm>>["control"]; register: ReturnType<typeof useForm<DraftForm>>["register"] }) {
  const name = `composition.${area}.${index}.items` as const;
  const { fields, append, remove, move } = useFieldArray({ control, name });
  return <div className="grouped-items">{fields.map((field, position) => <div className="grouped-item" key={field.id}>{type === "contacts" ? <><label>Name<input {...register(`${name}.${position}.name`)} /></label><label>Detail<input {...register(`${name}.${position}.detail`)} /></label></> : type === "qr" ? <><label>Caption<input {...register(`${name}.${position}.caption`)} /></label><label>Image asset<input {...register(`${name}.${position}.asset`)} /></label></> : <label>Announcement<input {...register(`${name}.${position}.text`)} /></label>}<div className="block-actions"><button type="button" disabled={position === 0} onClick={() => move(position, position - 1)}>Move up</button><button type="button" disabled={position === fields.length - 1} onClick={() => move(position, position + 1)}>Move down</button><button type="button" onClick={() => remove(position)}>Remove item</button></div></div>)}<button type="button" onClick={() => append(type === "contacts" ? { name: "", detail: "" } : type === "qr" ? { caption: "", asset: "" } : { text: "" })}>Add {type === "contacts" ? "contact" : type === "qr" ? "QR code" : "announcement"}</button></div>;
}

export function DraftEditor() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<"preview" | "edit">("edit");
  const draft = useQuery({ queryKey: ["draft", id], queryFn: async () => {
    const response = await api.api.bulletins({ id }).get();
    if (response.error || !response.data || !("composition" in response.data)) return resultError(response, "Could not open this draft. Try again.");
    return response.data as Draft;
  }, retry: false });
  if (draft.isPending) return <main className="center">Loading draft…</main>;
  if (draft.isError || !draft.data) return <main className="center"><p role="alert">{draft.error?.message ?? "Draft not found"}</p><Link to="/">Back to bulletins</Link></main>;
  return <EditorForm key={`${id}:${draft.data.revision}`} draft={draft.data} onSaved={(value) => { client.setQueryData(["draft", id], value); client.invalidateQueries({ queryKey: ["bulletins"] }); }} onBack={() => navigate("/")} view={view} setView={setView} />;
}

function EditorForm({ draft, onSaved, onBack, view, setView }: { draft: Draft; onSaved: (draft: Draft) => void; onBack: () => void; view: "preview" | "edit"; setView: (view: "preview" | "edit") => void }) {
  const { register, handleSubmit, control, getValues, setValue, watch, formState: { isDirty } } = useForm<DraftForm>({ defaultValues: { gatheringDate: draft.gatheringDate, composition: draft.composition } });
  const values = watch();
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [isDirty]);
  const save = useMutation({ mutationFn: async (form: DraftForm) => {
    const response = await api.api.bulletins({ id: draft.id }).put({ ...form, revision: draft.revision });
    if (response.error || !response.data || !("composition" in response.data)) return resultError(response, "Could not save this draft. Try again.");
    return response.data as Draft;
  }, onSuccess: onSaved });
  return <main className="editor"><div className="editor-header"><button className="quiet" onClick={() => { if (!isDirty || window.confirm("Discard unsaved changes?")) onBack(); }}>Bulletins</button><div><h1>Bulletin for {values.gatheringDate || draft.gatheringDate}</h1><p>{save.isSuccess ? "Saved draft" : isDirty ? "Unsaved changes" : `Saved draft · Revision ${draft.revision}`}</p></div><button className="primary" form="draft-form" type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save draft"}</button></div>
    <div className="mobile-view"><button aria-pressed={view === "edit"} onClick={() => setView("edit")}>Edit</button><button aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</button></div>
    <div className="editor-layout"><section className={`preview-column ${view === "edit" ? "mobile-hidden" : ""}`} aria-label="Draft structure preview"><p>Draft arrangement · Not a PDF proof</p><div className="sheet"><h2>Outside</h2><div className="panels"><div className="panel"><span>Reading order continues</span></div><div className="panel"><span>Cover</span>{values.composition.cover.map((block, i) => <div key={i} className="preview-block">{block.type === "branding" && block.asset === "ruf-baylor-logo.png" ? <img src="/ruf-baylor-logo.png" alt="RUF Baylor logo" /> : <><strong>{block.title || blockNames[block.type] || block.type}</strong>{block.text && <p>{block.text}</p>}</>}</div>)}</div></div></div><div className="sheet"><h2>Inside</h2><div className="panels">{[0, 1].map((column) => <div className="panel" key={column}>{values.composition.flow.filter((_, i) => i % 2 === column).map((block, i) => <div className="preview-block" key={i}><strong>{block.role === "sermon" ? "Sermon passage" : block.role === "reading" ? "Scripture reading" : blockNames[block.type] || block.type}</strong><p>{block.reference || block.title || block.text || block.songKey || ""}</p></div>)}</div>)}</div></div></section>
    <form id="draft-form" className={`editor-fields ${view === "preview" ? "mobile-hidden" : ""}`} onSubmit={handleSubmit((form) => save.mutate(form))}><h2>Draft details</h2><label htmlFor="gathering-date">Gathering date</label><input id="gathering-date" type="date" required {...register("gatheringDate", { required: true })} /><p className="field-note">The date is unique to this bulletin. Weekly words can remain blank.</p>
      {save.isError && <div role="alert" className="error">{save.error.message}{save.error.message.includes("newer revision") && <button type="button" onClick={() => { if (window.confirm("Reload the newest draft? Your unsaved edits will be lost.")) window.location.reload(); }}>Reload newest draft</button>}</div>}
      <BlockList area="cover" control={control} register={register} getValues={getValues} setValue={setValue} /><BlockList area="flow" control={control} register={register} getValues={getValues} setValue={setValue} />
      <button className="primary" type="submit" disabled={save.isPending}>{save.isPending ? "Saving…" : "Save draft"}</button></form></div>
  </main>;
}
