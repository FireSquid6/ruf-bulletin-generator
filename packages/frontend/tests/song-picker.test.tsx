import { afterEach, expect, test } from "bun:test";
import { window } from "./dom";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { useForm } from "react-hook-form";
import type { DraftForm } from "../src/components/BlockEditor";

const { render, screen, cleanup, waitFor } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { BlockEditor } = await import("../src/components/BlockEditor");
const { SongStore } = await import("../src/pages/SongStore");
const originalFetch = globalThis.fetch;
afterEach(() => { cleanup(); window.document.body.innerHTML = ""; globalThis.fetch = originalFetch; });

function Editor({ onSave, songKey = "lost-key" }: { onSave: (value: DraftForm) => void; songKey?: string }) {
  const form = useForm<DraftForm>({ defaultValues: { gatheringDate: "2034-05-21", composition: { cover: [], flow: [{ type: "song", songKey }] } } });
  return <form onSubmit={form.handleSubmit(onSave)}><BlockEditor form={form} /><button type="submit">Save draft</button></form>;
}

test("a missing song stays selected while server title/key search offers a repair without copying lyrics", async () => {
  const requested: string[] = [];
  const available = { key: "hymn-key", title: "A Fresh Hymn", parts: [{ text: "Lyrics only in store" }], columns: null, scale: null };
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    requested.push(`${url.pathname}${url.search}`);
    if (url.pathname === "/api/songs/lost-key") return Response.json({ error: "Song not found" }, { status: 404 });
    if (url.pathname === "/api/songs/hymn-key") return Response.json({ song: available });
    if (url.pathname === "/api/songs") {
      const term = (url.searchParams.get("search") ?? "").toLowerCase();
      return Response.json({ songs: available.title.toLowerCase().includes(term) || available.key.includes(term) ? [available] : [] });
    }
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const saved: DraftForm[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const user = userEvent.setup({ document: window.document as unknown as Document });
  render(<MemoryRouter><QueryClientProvider client={client}><Editor onSave={(value) => saved.push(value)} /></QueryClientProvider></MemoryRouter>);

  expect(await screen.findByText(/Missing song key/)).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Select song" }) as HTMLSelectElement).value).toBe("lost-key");
  expect(screen.getByRole("link", { name: /Add song under this key/ }).getAttribute("href")).toBe("/songs?new=1&key=lost-key");
  await user.type(screen.getByRole("searchbox", { name: "Find a song" }), "hymn-key");
  await waitFor(() => expect(requested.some((path) => path === "/api/songs?search=hymn-key")).toBe(true));
  expect(await screen.findByRole("option", { name: "A Fresh Hymn · hymn-key" })).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Select song" }) as HTMLSelectElement).value).toBe("lost-key");
  await user.clear(screen.getByRole("searchbox", { name: "Find a song" }));
  await user.type(screen.getByRole("searchbox", { name: "Find a song" }), "Fresh");
  await waitFor(() => expect(requested.some((path) => path === "/api/songs?search=Fresh")).toBe(true));
  expect(await screen.findByRole("option", { name: "A Fresh Hymn · hymn-key" })).toBeTruthy();
  await user.selectOptions(screen.getByRole("combobox", { name: "Select song" }), "hymn-key");
  expect(await screen.findByText(/Selected:/)).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(saved).toHaveLength(1);
  expect(saved[0].composition.flow).toEqual([{ type: "song", songKey: "hymn-key" }]);
  expect(JSON.stringify(saved[0])).not.toContain("Lyrics only in store");
});

test("a store edit updates the selected title, while rename, deletion and key reuse keep the draft key", async () => {
  let currentTitle: string | null = "First title";
  globalThis.fetch = (async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/songs/hymn-key") return currentTitle === null ? Response.json({ error: "Song not found" }, { status: 404 }) : Response.json({ song: { key: "hymn-key", title: currentTitle, parts: [{ text: "Store lyrics" }] } });
    if (url.pathname === "/api/songs") return Response.json({ songs: [] });
    throw new Error(`Unexpected request: ${url}`);
  }) as typeof fetch;
  const saved: DraftForm[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup({ document: window.document as unknown as Document });
  render(<MemoryRouter><QueryClientProvider client={client}><Editor songKey="hymn-key" onSave={(value) => saved.push(value)} /></QueryClientProvider></MemoryRouter>);
  expect(await screen.findByText("First title")).toBeTruthy();
  currentTitle = "Edited title";
  await client.invalidateQueries({ queryKey: ["song", "hymn-key"] });
  expect(await screen.findByText("Edited title")).toBeTruthy();
  currentTitle = null; // renamed or deleted in the store
  await client.invalidateQueries({ queryKey: ["song", "hymn-key"] });
  expect(await screen.findByText(/Missing song key/)).toBeTruthy();
  expect((screen.getByRole("combobox", { name: "Select song" }) as HTMLSelectElement).value).toBe("hymn-key");
  currentTitle = "Reused key title";
  await client.invalidateQueries({ queryKey: ["song", "hymn-key"] });
  expect(await screen.findByText("Reused key title")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(saved[0].composition.flow).toEqual([{ type: "song", songKey: "hymn-key" }]);
});

test("repair link opens a new song form with the missing key filled in", async () => {
  globalThis.fetch = (async (_input: RequestInfo | URL) => Response.json({ songs: [] })) as typeof fetch;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<MemoryRouter initialEntries={["/songs?new=1&key=lost-key"]}><QueryClientProvider client={client}><SongStore /></QueryClientProvider></MemoryRouter>);
  await waitFor(() => expect((screen.getByRole("textbox", { name: "Song key" }) as HTMLInputElement).value).toBe("lost-key"));
  expect(screen.getByRole("heading", { name: "New song" })).toBeTruthy();
});
