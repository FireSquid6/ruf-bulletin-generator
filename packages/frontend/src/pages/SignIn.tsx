import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { accountPolicy, session } from "../lib/session";

type LoginFields = { email: string; password: string };
export function SignIn() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["session"], queryFn: session, retry: false });
  const policy = useQuery({ queryKey: ["account-policy"], queryFn: accountPolicy });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginFields>();
  const login = useMutation({
    mutationFn: async (values: LoginFields) => {
      const response = await fetch("/api/auth/sign-in/email", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(values) });
      if (!response.ok) throw new Error(response.status === 403 ? "Confirm your email before signing in. Check your inbox or request a new link." : response.status === 401 || response.status === 400 ? "Email or password is incorrect." : "Could not sign in. Try again.");
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["session"] });
      navigate("/", { replace: true });
    },
  });
  if (current.data && (!current.data.confirmationRequired || current.data.user.emailVerified)) return <Navigate to="/" replace />;
  return <><header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong></div></header><main className="sign-in"><h1>Sign in</h1><p>Use your staff account to open the bulletin workspace.</p>{params.has("registered") && <p role="status" className="success">Account created. {policy.data?.emailConfirmation ? "Check your inbox to confirm your email before signing in." : "Sign in with your new password."}</p>}<form onSubmit={handleSubmit((values) => login.mutateAsync(values))}>
    <label htmlFor="email">Email</label><input id="email" aria-label="Email" type="email" autoComplete="username" {...register("email", { required: "Enter your email." })} aria-invalid={!!errors.email} />{errors.email && <small role="alert">{errors.email.message}</small>}
    <label htmlFor="password">Password</label><input id="password" aria-label="Password" type="password" autoComplete="current-password" {...register("password", { required: "Enter your password." })} aria-invalid={!!errors.password} />{errors.password && <small role="alert">{errors.password.message}</small>}
    {login.isError && <p role="alert" className="error">{login.error.message}</p>}
    <button className="primary" type="submit" disabled={isSubmitting || login.isPending}>{login.isPending ? "Signing in…" : "Sign in"}</button>
  </form><p className="form-followup"><Link to="/forgot-password">Forgot your password?</Link></p>{policy.data?.emailConfirmation && <p className="form-followup">Need a confirmation link? <Link to="/verify-email">Resend it</Link></p>}<p className="form-followup">Have an invitation? <Link to="/register">Create an account</Link></p></main></>;
}
