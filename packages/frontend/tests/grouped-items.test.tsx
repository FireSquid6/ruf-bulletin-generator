import { afterEach, expect, test } from "bun:test";
import { window } from "./dom";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { DraftForm } from "../src/BlockEditor";

const { render, screen, cleanup } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { BlockEditor } = await import("../src/BlockEditor");
afterEach(() => { cleanup(); window.document.body.innerHTML = ""; });

function Editor({ onSave, initial }: { onSave: (value: DraftForm) => void; initial: DraftForm }) {
  const form = useForm<DraftForm>({ defaultValues: initial });
  return <form onSubmit={form.handleSubmit(onSave)}><BlockEditor form={form} /><button type="submit">Save draft</button></form>;
}

test("staff can edit, reorder and remove structured items even after moving their parent block", async () => {
  const user = userEvent.setup({ document: window.document as unknown as Document });
  const saved: DraftForm[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["assets"], [{ id: "qr-image", name: "Join QR", kind: "qr" }]);
  render(<QueryClientProvider client={client}><Editor onSave={(value) => saved.push(value)} initial={{ gatheringDate: "2034-05-21", composition: { cover: [
    { type: "announcements", items: [{ title: "Alpha", text: "First" }, { title: "Beta", text: "Second" }] },
    { type: "contacts", items: [{ name: "Pat", detail: "old" }] },
  ], flow: [{ type: "qr", items: [] }] } }} /></QueryClientProvider>);

  await user.clear(screen.getByRole("textbox", { name: "Announcement 1 title" }));
  await user.type(screen.getByRole("textbox", { name: "Announcement 1 title" }), "Changed");
  await user.click(screen.getByRole("button", { name: "Move announcement 2 up" }));
  await user.click(screen.getByRole("button", { name: "Add announcement" }));
  await user.type(screen.getByRole("textbox", { name: "Announcement 3 title" }), "Gamma");
  await user.type(screen.getByRole("textbox", { name: "Announcement 3 text" }), "Third");
  await user.click(screen.getByRole("button", { name: "Remove announcement 2" }));
  await user.type(screen.getByRole("textbox", { name: "Contact 1 detail" }), " updated");
  await user.click(screen.getByRole("button", { name: "Add contact" }));
  await user.type(screen.getByRole("textbox", { name: "Contact 2 name" }), "Lee");
  await user.type(screen.getByRole("textbox", { name: "Contact 2 detail" }), "lee@example.org");
  await user.click(screen.getByRole("button", { name: "Move contact 2 up" }));
  await user.click(screen.getByRole("button", { name: "Add QR code" }));
  await user.type(screen.getByRole("textbox", { name: "QR code 1 caption" }), "Join us");
  await user.type(screen.getByRole("spinbutton", { name: "QR code 1 size (mm)" }), "20");
  await user.click(screen.getByRole("button", { name: "Add QR code" }));
  await user.type(screen.getByRole("textbox", { name: "QR code 2 caption" }), "Scan");
  await user.selectOptions(screen.getAllByRole("combobox", { name: "QR image asset" })[1], "qr-image");
  await user.click(screen.getByRole("button", { name: "Move QR code 2 up" }));
  await user.click(screen.getAllByRole("button", { name: "Move to reading order" })[0]);
  await user.click(screen.getByRole("button", { name: "Move Announcements 2 up in reading order" }));
  await user.type(screen.getByRole("textbox", { name: "Announcement 2 text" }), "!" );
  await user.click(screen.getByRole("button", { name: "Move Announcements 1 down in reading order" }));
  await user.click(screen.getByRole("button", { name: "Save draft" }));

  expect(saved).toHaveLength(1);
  expect(saved[0].composition.cover).toEqual([{ type: "contacts", items: [
    { name: "Lee", detail: "lee@example.org" }, { name: "Pat", detail: "old updated" },
  ] }]);
  expect(JSON.parse(JSON.stringify(saved[0].composition.flow))).toEqual([
    { type: "qr", items: [{ caption: "Scan", assetId: "qr-image" }, { caption: "Join us", assetId: "", size_mm: 20 }] },
    { type: "announcements", title: "", items: [{ title: "Beta", text: "Second" }, { title: "Gamma", text: "Third!" }] },
  ]);
});
