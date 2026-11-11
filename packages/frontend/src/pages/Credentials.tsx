import { useState } from "react";
import { Link } from "react-router";
import { useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

type Fields = { userId: string; label: string };

export function Credentials() {
  const client = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const { register, handleSubmit, reset, formState: { errors } } = useForm<Fields>();
  const staff = useQuery({ queryKey: ["staff"], queryFn: async () => {
    const result = await api.api.staff.get();
    if (result.error || !result.data || !("staff" in result.data)) throw new Error("Could not load staff accounts.");
    return result.data.staff;
  }, retry: false });
  const keys = useQuery({ queryKey: ["keys"], queryFn: async () => {
    const result = await api.api.keys.get();
    if (result.error || !result.data || !("keys" in result.data)) throw new Error("Could not load credentials.");
    return result.data.keys;
  }, retry: false });
  const issue = useMutation({
    mutationFn: async (values: Fields) => {
      const result = await api.api.keys.post(values);
      if (result.error || !result.data || !("secret" in result.data)) throw new Error("Could not issue the key. Check the account and try again.");
      return result.data.secret;
    },
    onSuccess: async (value) => { setSecret(value); reset(); await client.invalidateQueries({ queryKey: ["keys"] }); },
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      const result = await api.api.keys({ id }).revoke.post();
      if (result.error) throw new Error("Could not revoke the key. Try again.");
    },
    onSuccess: async () => { setConfirmId(null); await client.invalidateQueries({ queryKey: ["keys"] }); },
  });

  return <main className="workspace credentials">
    <Link to="/" className="back-link">← Bulletins</Link>
    <div className="workspace-heading"><div><h1>MCP credentials</h1><p>Issue keys for named staff accounts. Each key can be revoked independently.</p></div></div>
    {secret && <section className="secret-once" aria-label="New key"><h2>Copy this key now</h2><p>This is the only time it will be shown. Store it securely; create a replacement if you lose it.</p><div className="secret-value"><code>{secret}</code><button type="button" onClick={() => navigator.clipboard.writeText(secret)}>Copy</button></div><button type="button" onClick={() => setSecret(null)}>I’ve saved it</button></section>}
    <section className="credential-issue"><h2>Issue a key</h2>
      {staff.isPending ? <p>Loading staff…</p> : staff.isError ? <p role="alert" className="error">{staff.error.message} <button onClick={() => staff.refetch()}>Try again</button></p> :
        <form onSubmit={handleSubmit((values) => issue.mutateAsync(values))}>
          <div className="credential-fields"><div><label htmlFor="key-user">Staff account</label><select id="key-user" defaultValue="" aria-invalid={!!errors.userId} {...register("userId", { required: "Choose a staff account." })}><option value="">Choose an account</option>{staff.data.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select>{errors.userId && <small role="alert">{errors.userId.message}</small>}</div>
          <div><label htmlFor="key-label">Key name</label><input id="key-label" placeholder="e.g. Office desktop" maxLength={100} aria-invalid={!!errors.label} {...register("label", { required: "Name this key.", maxLength: 100 })} />{errors.label && <small role="alert">{errors.label.message}</small>}</div></div>
          {issue.isError && <p role="alert" className="error">{issue.error.message}</p>}
          <button className="primary" type="submit" disabled={issue.isPending || !!secret}>{issue.isPending ? "Issuing…" : "Issue key"}</button>
        </form>}
    </section>
    <section className="credential-list"><h2>Issued keys</h2>
      {keys.isPending ? <p>Loading keys…</p> : keys.isError ? <p role="alert" className="error">{keys.error.message} <button onClick={() => keys.refetch()}>Try again</button></p> : keys.data.length === 0 ? <p>No keys have been issued yet.</p> :
        <ul>{keys.data.map((key) => <li key={key.id}><div><strong>{key.label}</strong><span>{key.userName} · {key.userEmail}</span><span>Issued {new Date(key.createdAt).toLocaleDateString()}</span></div><div className="key-actions">{key.revokedAt ? <span className="revoked">Revoked</span> : confirmId === key.id ? <><span>Revoke this key?</span><button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(key.id)}>Confirm revoke</button><button type="button" className="quiet" onClick={() => setConfirmId(null)}>Cancel</button></> : <button type="button" onClick={() => setConfirmId(key.id)}>Revoke</button>}</div></li>)}</ul>}
      {revoke.isError && <p role="alert" className="error">{revoke.error.message}</p>}
    </section>
  </main>;
}
