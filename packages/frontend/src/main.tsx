import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "./api";
import { AssetLibrary } from "./AssetLibrary";
import { Credentials } from "./Credentials";
import "./style.css";

const queryClient = new QueryClient();

async function session() {
  const response = await fetch("/api/auth/get-session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not check your session. Try again.");
  return (await response.json()) as null | { user: { name: string; email: string; role: string } };
}

function Workspace({ credentials = false }: { credentials?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["session"], queryFn: session, retry: false });
  const bulletins = useQuery({
    queryKey: ["bulletins"],
    queryFn: async () => {
      const result = await api.api.bulletins.get();
      if (result.error || !result.data || !("bulletins" in result.data) || !Array.isArray(result.data.bulletins)) throw new Error("Could not load bulletins. Try again.");
      return result.data as { bulletins: { id: string; gatheringDate: string }[] };
    },
    enabled: Boolean(current.data) && !credentials && location.pathname !== "/assets",
    retry: false,
  });
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
    <header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong><nav aria-label="Workspace"><Link to="/">Bulletins</Link><Link to="/assets">Images</Link>{current.data.user.role === "admin" && <Link to="/credentials">MCP credentials</Link>}</nav><div className="account"><span>{current.data.user.email}</span><button className="quiet" disabled={logout.isPending} onClick={() => logout.mutate()}>Sign out</button></div></div></header>
    {credentials ? <Credentials /> : location.pathname === "/assets" ? <AssetLibrary /> : <main className="workspace">
      <div className="workspace-heading"><div><h1>Bulletins</h1><p>Gathering dates and saved drafts</p></div></div>
      {logout.isError && <p role="alert" className="error">{logout.error.message}</p>}
      {bulletins.isPending ? <p>Loading bulletins…</p> : bulletins.isError ? <p role="alert">{bulletins.error.message} <button onClick={() => bulletins.refetch()}>Try again</button></p> : bulletins.data?.bulletins.length === 0 ?
        <section className="empty"><h2>No bulletins yet</h2><p>This workspace is ready for your first gathering bulletin. Bulletin creation is coming next; the YAML generator remains available from the command line.</p></section> :
        <ul className="bulletin-list">{bulletins.data?.bulletins.map((item) => <li key={item.id}>{item.gatheringDate}</li>)}</ul>}
    </main>}
  </>;
}

type LoginFields = { email: string; password: string };
function SignIn() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["session"], queryFn: session, retry: false });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFields>();
  const login = useMutation({
    mutationFn: async (values: LoginFields) => {
      const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(values) });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 400 ? "Email or password is incorrect." : "Could not sign in. Try again.");
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["session"] });
      navigate("/", { replace: true });
    },
  });
  if (current.data) return <Navigate to="/" replace />;
  return <><header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong></div></header><main className="sign-in"><h1>Sign in</h1><p>Use your staff account to open the bulletin workspace.</p><form onSubmit={handleSubmit((values) => login.mutateAsync(values))}>
    <label htmlFor="email">Email</label><input id="email" aria-label="Email" type="email" autoComplete="username" {...register("email", { required: "Enter your email." })} aria-invalid={!!errors.email} />{errors.email && <small role="alert">{errors.email.message}</small>}
    <label htmlFor="password">Password</label><input id="password" aria-label="Password" type="password" autoComplete="current-password" {...register("password", { required: "Enter your password." })} aria-invalid={!!errors.password} />{errors.password && <small role="alert">{errors.password.message}</small>}
    {login.isError && <p role="alert" className="error">{login.error.message}</p>}
    <button className="primary" type="submit" disabled={isSubmitting || login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</button>
  </form></main></>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><Routes><Route path="/sign-in" element={<SignIn />} /><Route path="/credentials" element={<Workspace credentials />} /><Route path="*" element={<Workspace />} /></Routes></BrowserRouter></QueryClientProvider></React.StrictMode>);
