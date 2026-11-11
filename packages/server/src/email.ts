import { Resend } from "resend";

/** Auth depends on this port, not the email provider. */
export type Mailer = { send(message: { to: string; subject: string; text: string }): Promise<void> };

export function resendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    async send({ to, subject, text }) {
      const { error } = await resend.emails.send({ from, to, subject, text });
      if (error) throw new Error(`Email delivery failed: ${error.message}`);
    },
  };
}

export function configuredMailer(): Mailer {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) throw new Error("Set RESEND_API_KEY and EMAIL_FROM for account email");
  return resendMailer(key, from);
}
