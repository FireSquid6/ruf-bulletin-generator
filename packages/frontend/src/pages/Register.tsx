import { Link, Navigate, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { api } from "../lib/api";
import { session } from "../lib/session";

type Fields = { email: string; password: string; invitationKey: string };

export function Register() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const current = useQuery({ queryKey: ["session"], queryFn: session, retry: false });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<Fields>();
  const registration = useMutation({
    mutationFn: async (values: Fields) => {
      const response = await api.api.register.post(values);
      if (response.error) throw new Error(response.status === 400 ? "Invitation key is invalid or already used, or these account details cannot be accepted." : "Could not create your account. Try again.");
    },
    onSuccess: () => {
      client.setQueryData(["session"], null);
      navigate("/sign-in?registered=1", { replace: true });
    },
  });
  if (current.data && (!current.data.confirmationRequired || current.data.user.emailVerified)) return <Navigate to="/" replace />;
  return <><header className="bar"><div className="bar-inner"><strong>RUF Bulletin Studio</strong></div></header>
    <main className="sign-in"><h1>Create a staff account</h1><p>Enter the invitation key given to you by an administrator. Each key can be used once.</p>
      <form onSubmit={handleSubmit(values => registration.mutateAsync(values))}>
        <label htmlFor="register-email">Email</label><input id="register-email" aria-label="Email" type="email" autoComplete="email" {...register("email", { required: "Enter your email." })} aria-invalid={!!errors.email} />{errors.email && <small role="alert">{errors.email.message}</small>}
        <label htmlFor="register-password">Password</label><input id="register-password" aria-label="Password" type="password" autoComplete="new-password" minLength={8} {...register("password", { required: "Enter a password.", minLength: { value: 8, message: "Use at least 8 characters." } })} aria-invalid={!!errors.password} />{errors.password && <small role="alert">{errors.password.message}</small>}
        <label htmlFor="invitation-key">Invitation key</label><input id="invitation-key" aria-label="Invitation key" autoComplete="off" maxLength={16} {...register("invitationKey", { required: "Enter your invitation key.", pattern: { value: /^[A-Za-z0-9_-]{16}$/, message: "Enter the full 16-character key." } })} aria-invalid={!!errors.invitationKey} />{errors.invitationKey && <small role="alert">{errors.invitationKey.message}</small>}
        {registration.isError && <p role="alert" className="error">{registration.error.message}</p>}
        <button className="primary" type="submit" disabled={isSubmitting || registration.isPending}>{registration.isPending ? "Creating account…" : "Create account"}</button>
      </form><p className="form-followup">Already have an account? <Link to="/sign-in">Sign in</Link></p>
    </main></>;
}
