import { afterEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const window = new Window();
Object.assign(globalThis, { window, document: window.document, navigator: window.navigator, HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver });
const { render, screen, cleanup, waitFor } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { DraftEditor } = await import("../src/drafts");
const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
afterEach(() => { cleanup(); window.document.body.innerHTML = ""; globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; });

test("generated PDF bytes back both preview and download, while generation errors locate saved blocks", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["draft", "saved"], { id: "saved", gatheringDate: "2034-05-21", revision: 2, composition: { cover: [{ type: "heading", title: "Gathering" }], flow: [] } });
  const pdf = new Blob(["%PDF-1.3 actual bytes"], { type: "application/pdf" });
  let requested = 0;
  globalThis.fetch = (async (input) => {
    expect(String(input)).toContain("/api/bulletins/saved/pdf");
    requested++;
    return requested === 1 ? new Response(pdf, { status: 200, headers: { "content-type": "application/pdf" } }) :
      Response.json({ error: "Cover block 1 (heading) does not fit", block: { area: "cover", index: 0, type: "heading" } }, { status: 422 });
  }) as typeof fetch;
  let received: Blob | undefined;
  URL.createObjectURL = (blob) => { received = blob as Blob; return "blob:generated-pdf"; };
  URL.revokeObjectURL = () => {};
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/bulletins/saved"]}><Routes><Route path="/bulletins/:id" element={<DraftEditor />} /></Routes></MemoryRouter></QueryClientProvider>);
  const user = userEvent.setup({ document: window.document as unknown as Document });
  await user.click(screen.getByRole("button", { name: "Generate preview" }));
  const download = await screen.findByRole("link", { name: "Download PDF" });
  expect(await received!.text()).toBe("%PDF-1.3 actual bytes");
  expect(download.getAttribute("href")).toBe("blob:generated-pdf");
  expect(download.getAttribute("download")).toBe("ruf-bulletin-2034-05-21.pdf");
  expect(screen.getByTitle("Generated bulletin for 2034-05-21").getAttribute("src")).toBe(download.getAttribute("href"));
  await user.click(screen.getByRole("button", { name: "Refresh PDF" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("link", { name: "Download PDF" })).toBeNull();
  expect(screen.getByRole("button", { name: "Locate block" })).toBeDefined();
  expect(requested).toBe(2);
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Cover block 1"));
});
