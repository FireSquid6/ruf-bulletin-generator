import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { accountPolicy } from "../lib/session";

async function authPost(path: string, body: object) {
  const response = await fetch(`/api/auth/${path}`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("This request could not be completed. Try again or request a new link.");
}

function Header() { return <header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong></div></header>; }

export function ForgotPassword() {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  return <><Header /><main className="sign-in"><h1>Reset your password</h1><p>Enter your staff email. If an account exists, we’ll send a reset link.</p>
    {sent ? <p role="status" className="success">If an account exists, a reset link is on its way. Check your inbox.</p> : <form onSubmit={handleSubmit(async ({ email }) => {
      setError("");
      try { await authPost("request-password-reset", { email, redirectTo: `${window.location.origin}/reset-password` }); setSent(true); }
      catch (cause) { setError((cause as Error).message); }
    })}><label htmlFor="recovery-email">Email</label><input id="recovery-email" type="email" autoComplete="email" {...register("email", { required: "Enter your email." })} aria-invalid={!!errors.email} />{errors.email && <small role="alert">{errors.email.message}</small>}
      {error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={isSubmitting}>Send reset link</button></form>}
    <p className="form-followup"><Link to="/sign-in">Back to sign in</Link></p></main></>;
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ password: string }>();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  return <><Header /><main className="sign-in"><h1>Choose a new password</h1>
    {!token || params.has("error") ? <p role="alert" className="error">This reset link is invalid or expired. <Link to="/forgot-password">Request a new link</Link>.</p> : done ? <p role="status" className="success">Password updated. <Link to="/sign-in">Sign in</Link> with your new password.</p> : <form onSubmit={handleSubmit(async ({ password }) => {
      setError("");
      try { await authPost("reset-password", { token, newPassword: password }); setDone(true); }
      catch { setError("This link is invalid or expired, or the password could not be accepted. Request a new link and try again."); }
    })}><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" minLength={8} {...register("password", { required: "Enter a new password.", minLength: { value: 8, message: "Use at least 8 characters." } })} aria-invalid={!!errors.password} />{errors.password && <small role="alert">{errors.password.message}</small>}
      {error && <p role="alert" className="error">{error} <Link to="/forgot-password">Request a new link</Link></p>}<button className="primary" disabled={isSubmitting}>Update password</button></form>}
    <p className="form-followup"><Link to="/sign-in">Back to sign in</Link></p></main></>;
}

export function VerifyEmail() {
  const policy = useQuery({ queryKey: ["account-policy"], queryFn: accountPolicy });
  const [params] = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<{ email: string }>();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  if (policy.data && !policy.data.emailConfirmation) return <><Header /><main className="sign-in"><h1>Email confirmation is off</h1><p>There’s no need to confirm your email to use this workspace.</p><p className="form-followup"><Link to="/sign-in">Back to sign in</Link></p></main></>;
  return <><Header /><main className="sign-in"><h1>Confirm your email</h1>
    {params.has("error") ? <p role="alert" className="error">That confirmation link is invalid or expired. Request a new one below.</p> : params.has("confirmed") && <p role="status" className="success">Email confirmed. You can now sign in.</p>}
    <p>Enter your staff email to request a confirmation link. Check your inbox before trying again.</p>
    <form onSubmit={handleSubmit(async ({ email }) => {
      setError("");
      try { await authPost("send-verification-email", { email, callbackURL: "/verify-email?confirmed=1" }); setSent(true); }
      catch { setError("Could not send a confirmation link. Check your email or try again later."); }
    })}><label htmlFor="confirmation-email">Email</label><input id="confirmation-email" type="email" autoComplete="email" {...register("email", { required: "Enter your email." })} aria-invalid={!!errors.email} />{errors.email && <small role="alert">{errors.email.message}</small>}
      {sent && <p role="status" className="success">If this email needs confirmation, a link is on its way.</p>}
      {error && <p role="alert" className="error">{error}</p>}<button className="primary" disabled={isSubmitting}>Send confirmation link</button></form>
    <p className="form-followup"><Link to="/sign-in">Back to sign in</Link></p></main></>;
}
