export type StaffSession = { user: { name: string; email: string; role: string; emailVerified: boolean }; confirmationRequired: boolean };

export async function accountPolicy(): Promise<{ emailConfirmation: boolean }> {
  const response = await fetch("/api/account-policy");
  if (!response.ok) throw new Error("Could not load account settings.");
  return response.json();
}

export async function session(): Promise<StaffSession | null> {
  const response = await fetch("/api/session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not check your session. Try again.");
  return response.json();
}
