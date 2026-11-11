import { Link, Navigate, Route, Routes, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BulletinIndex, DraftEditor, NewDraft } from "../pages/drafts";
import { AssetLibrary } from "../pages/AssetLibrary";
import { Credentials } from "../pages/Credentials";
import { SongStore } from "../pages/SongStore";
import { session } from "../lib/session";

export function Workspace({ credentials = false }: { credentials?: boolean }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["session"], queryFn: session, retry: false });
  const logout = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("Could not sign out. Try again.");
    },
    onSuccess: async () => {
      client.clear();
      navigate("/sign-in", { replace: true });
    },
  });

  if (current.isPending) return <main className="center"><p>Checking your session…</p></main>;
  if (current.isError) return <main className="center"><p role="alert">{current.error.message}</p><button onClick={() => current.refetch()}>Try again</button></main>;
  if (!current.data) return <Navigate to="/sign-in" replace />;
  if (credentials && current.data.user.role !== "admin") return <Navigate to="/" replace />;

  return <>
    <header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong><nav aria-label="Workspace"><Link to="/">Bulletins</Link><Link to="/songs">Song store</Link><Link to="/assets">Images</Link>{current.data.user.role === "admin" && <><Link to="/invitations">Staff invitations</Link><Link to="/credentials">MCP credentials</Link></>}</nav><div className="account"><span>{current.data.user.email}</span><button className="quiet" disabled={logout.isPending} onClick={() => logout.mutate()}>Sign out</button></div></div></header>
    {logout.isError && <p role="alert" className="error workspace">{logout.error.message}</p>}
    <Routes><Route path="/" element={<BulletinIndex />} /><Route path="/bulletins/new" element={<NewDraft />} /><Route path="/bulletins/:id" element={<DraftEditor />} /><Route path="/songs" element={<SongStore />} /><Route path="/assets" element={<AssetLibrary />} /><Route path="/credentials" element={<Credentials />} /><Route path="*" element={<Navigate to="/" replace />} /></Routes>
  </>;
}
