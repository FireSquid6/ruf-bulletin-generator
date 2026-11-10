import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "./api";
import { DraftConflict, type DraftSnapshot } from "./DraftConflict";
import { BlockEditor, type DraftForm } from "./BlockEditor";

type Draft = { id: string; gatheringDate: string; revision: number; composition: DraftForm["composition"] };
function dateString(value: string | Date) { return value instanceof Date ? value.toISOString().slice(0, 10) : value; }
function draftFromApi(value: Draft): Draft { return { ...value, gatheringDate: dateString(value.gatheringDate) }; }

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
    return (response.data.bulletins ?? []).map((item) => ({ ...item, gatheringDate: dateString(item.gatheringDate) }));
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

export function DraftEditor() {
  const { id = "" } = useParams();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [view, setView] = useState<"preview" | "edit">("edit");
  const draft = useQuery({ queryKey: ["draft", id], queryFn: async () => {
    const response = await api.api.bulletins({ id }).get();
    if (response.error || !response.data || !("composition" in response.data)) return resultError(response, "Could not open this draft. Try again.");
    return draftFromApi(response.data as Draft);
  }, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
  if (draft.isPending) return <main className="center">Loading draft…</main>;
  if (draft.isError || !draft.data) return <main className="center"><p role="alert">{draft.error?.message ?? "Draft not found"}</p><Link to="/">Back to bulletins</Link></main>;
  return <EditorForm key={`${id}:${draft.data.revision}`} draft={draft.data} onSaved={(value) => { client.setQueryData(["draft", id], value); client.invalidateQueries({ queryKey: ["bulletins"] }); }} onBack={() => navigate("/")} view={view} setView={setView} />;
}

function EditorForm({ draft, onSaved, onBack, view, setView }: { draft: Draft; onSaved: (draft: Draft) => void; onBack: () => void; view: "preview" | "edit"; setView: (view: "preview" | "edit") => void }) {
  const form = useForm<DraftForm>({ defaultValues: { gatheringDate: draft.gatheringDate, composition: draft.composition } });
  const { register, handleSubmit, watch, getValues, formState: { isDirty } } = form;
  const values = watch();
  const [latest, setLatest] = useState<Draft | null>(null);
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  const pdf = useMutation({ mutationFn: async () => {
    const response = await fetch(`/api/bulletins/${encodeURIComponent(draft.id)}/pdf`, { credentials: "same-origin" });
    if (!response.ok) {
      const detail = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(detail?.error ?? (response.status === 401 ? "Sign in again to generate this PDF." : "Could not generate the PDF. Try again."));
    }
    return URL.createObjectURL(await response.blob());
  }, onSuccess: (url) => { setPdfUrl(url); setView("preview"); } });
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (isDirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", guard); return () => window.removeEventListener("beforeunload", guard); }, [isDirty]);
  const save = useMutation({ mutationFn: async ({ form, revision }: { form: DraftForm; revision: number }) => {
    const response = await api.api.bulletins({ id: draft.id }).put({ ...form, revision });
    if (response.status === 409) {
      const value = (response.error as { value?: { latest?: DraftSnapshot; error?: string } } | null)?.value;
      if (value?.latest) {
        setLatest(draftFromApi(value.latest as Draft));
        setConflictError(null);
        setView("edit");
        throw new Error("A newer version is available to review.");
      }
    }
    if (response.error || !response.data || !("composition" in response.data)) return resultError(response, "Could not save this draft. Try again.");
    return draftFromApi(response.data as Draft);
  }, onSuccess: (value) => { setPdfUrl(null); pdf.reset(); onSaved(value); } });
  return <main className="editor"><div className="editor-header"><button className="quiet" onClick={() => { if (!isDirty || window.confirm("Discard unsaved changes?")) onBack(); }}>Bulletins</button><div><h1>Bulletin for {values.gatheringDate || draft.gatheringDate}</h1><p>{latest ? "Save conflict · Your edits are unsaved" : save.isSuccess ? "Saved draft" : isDirty ? "Unsaved changes" : `Saved draft · Revision ${draft.revision}`}</p></div><button className="primary" form="draft-form" type="submit" disabled={save.isPending || !!latest}>{save.isPending ? "Saving…" : "Save draft"}</button></div>
    <div className="mobile-view"><button aria-pressed={view === "edit"} onClick={() => setView("edit")}>Edit</button><button aria-pressed={view === "preview"} onClick={() => setView("preview")}>Preview</button></div>
    <div className="editor-layout"><section className={`preview-column pdf-preview ${view === "edit" ? "mobile-hidden" : ""}`} aria-label="Generated PDF preview"><div className="pdf-toolbar"><div><h2>PDF preview</h2><p>{pdfUrl ? `Saved bulletin · ${draft.gatheringDate}` : "Preview the saved bulletin with the actual PDF generator."}</p></div><div className="pdf-actions"><button type="button" onClick={() => pdf.mutate()} disabled={pdf.isPending || isDirty || !!latest || save.isPending}>{pdf.isPending ? "Generating…" : pdfUrl ? "Refresh PDF" : "Generate preview"}</button>{pdfUrl && !isDirty && !latest && <a className="pdf-download" href={pdfUrl} download={`ruf-bulletin-${draft.gatheringDate}.pdf`}>Download PDF</a>}</div></div>{isDirty && <p className="pdf-notice" role="status">Save your changes before generating a new PDF. The current PDF, if shown, reflects the last saved version.</p>}{latest && <p className="pdf-notice">Resolve the save conflict before generating a PDF.</p>}{pdf.isError && <p className="pdf-error" role="alert">{pdf.error.message} Your draft is still saved. Edit the named block and try again.</p>}{pdfUrl ? <iframe className="pdf-frame" src={pdfUrl} title={`Generated bulletin for ${draft.gatheringDate}`} /> : <div className="pdf-empty"><p>The folded A4 sheet will appear here after generation.</p><p>Outside and inside pages are rendered by PDFKit, not browser layout.</p></div>}</section>
    <form id="draft-form" className={`editor-fields ${view === "preview" ? "mobile-hidden" : ""}`} onSubmit={handleSubmit((form) => { if (!latest) save.mutate({ form, revision: draft.revision }); })}><h2>Draft details</h2><label htmlFor="gathering-date">Gathering date</label><input id="gathering-date" type="date" required {...register("gatheringDate", { required: true })} /><p className="field-note">The date is unique to this bulletin. Weekly words can remain blank.</p>
      {latest && <DraftConflict latest={latest} local={getValues()} saving={save.isPending} error={conflictError ?? undefined}
        onUseLatest={() => { if (window.confirm("Replace your unsaved edits with the newer saved draft? This cannot be undone.")) onSaved(latest); }}
        onOverwrite={() => { if (window.confirm(`Overwrite saved revision ${latest.revision} with your current edits? The newer saved content will be replaced.`)) { setConflictError(null); save.mutate({ form: getValues(), revision: latest.revision }, { onError: (error) => { if (error.message !== "A newer version is available to review.") setConflictError(error.message); } }); } }} />}
      {save.isError && !latest && <div role="alert" className="error">{save.error.message}</div>}
      <BlockEditor form={form} />
      <button className="primary" type="submit" disabled={save.isPending || !!latest}>{save.isPending ? "Saving…" : "Save draft"}</button></form></div>
  </main>;
}
