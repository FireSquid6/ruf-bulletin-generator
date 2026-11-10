import { Link, Navigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { session } from "../lib/session";

export function Invitations() {
  const current = useQuery({ queryKey: ["session"], queryFn: session, retry: false });
  const client = useQueryClient();
  const list = useQuery({
    queryKey: ["invitations"], enabled: current.data?.user.role === "admin", retry: false,
    queryFn: async () => {
      const response = await api.api.invitations.get();
      if (response.error || !response.data || !("invitations" in response.data)) throw new Error("Could not load invitations. Try again.");
      return response.data.invitations;
    },
  });
  const issue = useMutation({
    mutationFn: async () => {
      const response = await api.api.invitations.post({});
      if (response.error || !response.data || !("key" in response.data)) throw new Error("Could not create an invitation. Try again.");
      return response.data.key;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["invitations"] }),
  });
  if (current.isPending) return <main className="center">Checking your session…</main>;
  if (current.isError) return <main className="center"><p role="alert">{current.error.message}</p><button onClick={() => current.refetch()}>Try again</button></main>;
  if (!current.data) return <Navigate to="/sign-in" replace />;
  if (current.data.user.role !== "admin") return <Navigate to="/" replace />;

  return <><header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong><nav aria-label="Workspace"><Link to="/">Bulletins</Link><Link to="/assets">Images</Link><Link to="/invitations" aria-current="page">Staff invitations</Link><Link to="/credentials">MCP credentials</Link></nav></div></header>
    <main className="workspace invitation-page"><div className="workspace-heading"><div><h1>Staff invitations</h1><p>Issue a single-use key for a staff member to create an account.</p></div></div>
      <section className="invitation-issue" aria-label="Issue an invitation"><button className="primary" type="button" disabled={issue.isPending} onClick={() => issue.mutate()}>{issue.isPending ? "Generating…" : "Generate invitation"}</button><p>Share the key directly with the staff member. It will not be shown again.</p></section>
      {issue.isError && <p role="alert" className="error">{issue.error.message}</p>}
      {issue.data && <div className="invitation-result" role="status"><strong>New invitation key</strong><code>{issue.data}</code><p>Copy this key now; it will not appear in the list below.</p></div>}
      <section className="invitation-history"><h2>Issued invitations</h2>
        {list.isPending ? <p>Loading invitations…</p> : list.isError ? <p role="alert">{list.error.message} <button onClick={() => list.refetch()}>Try again</button></p> : list.data?.length === 0 ? <p>No invitations issued yet.</p> :
          <ul>{list.data?.map(item => <li key={item.id}><span>Issued {new Date(item.createdAt).toLocaleDateString()}</span><span className={item.consumedAt ? "used" : "available"}>{item.consumedAt ? "Used" : "Available"}</span></li>)}</ul>}
      </section>
    </main></>;
}
