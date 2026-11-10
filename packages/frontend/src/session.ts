export type StaffSession = { user: { name: string; email: string; role: string } };

export async function session(): Promise<StaffSession | null> {
  const response = await fetch("/api/auth/get-session", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not check your session. Try again.");
  return response.json();
}
