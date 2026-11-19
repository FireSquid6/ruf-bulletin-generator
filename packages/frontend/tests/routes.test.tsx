import { afterEach, expect, test } from "bun:test";
import { window } from "./dom";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";

const { render, screen, cleanup } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { App } = await import("../src/App");
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); window.document.body.innerHTML = ""; globalThis.fetch = originalFetch; });

function mount(path: string, role = "admin") {
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input), window.location.origin);
    requests.push(url.pathname);
    switch (url.pathname) {
      case "/api/session": return Response.json({ user: { name: "Staff", email: "staff@example.org", role, emailVerified: true }, confirmationRequired: false });
      case "/api/songs": return Response.json({ songs: [] });
      case "/api/bulletins": return Response.json({ bulletins: [] });
      case "/api/assets": return Response.json({ assets: [] });
      case "/api/staff": return Response.json({ staff: [] });
      case "/api/keys": return Response.json({ keys: [] });
      default: throw new Error(`Unexpected request: ${url}`);
    }
  }) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></QueryClientProvider>);
  return requests;
}

for (const [path, heading] of [["/", "Bulletins"], ["/songs", "Song store"], ["/assets", "Images"], ["/credentials", "MCP credentials"]]) {
  test(`direct navigation to ${path} renders ${heading}`, async () => {
    mount(path);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeTruthy();
    if (path !== "/") expect(screen.queryByRole("heading", { level: 1, name: "Bulletins" })).toBeNull();
  });
}

test("song navigation works in both directions without falling back to Bulletins", async () => {
  mount("/");
  const user = userEvent.setup({ document: window.document as unknown as Document });
  expect(await screen.findByRole("heading", { level: 1, name: "Bulletins" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Song store" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Song store" })).toBeTruthy();
  await user.click(screen.getByRole("link", { name: "Bulletins" }));
  expect(await screen.findByRole("heading", { level: 1, name: "Bulletins" })).toBeTruthy();
});

test("staff cannot mount the administrator credentials page", async () => {
  const requests = mount("/credentials", "staff");
  expect(await screen.findByRole("heading", { level: 1, name: "Bulletins" })).toBeTruthy();
  expect(requests).not.toContain("/api/keys");
  expect(requests).not.toContain("/api/staff");
});
