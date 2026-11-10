import { afterEach, expect, test } from "bun:test";
import { window } from "./dom";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import type { DraftForm } from "../src/components/BlockEditor";

const { render, screen, cleanup } = await import("@testing-library/react");
const userEvent = (await import("@testing-library/user-event")).default;
const { BlockEditor } = await import("../src/components/BlockEditor");
const { AssetPreview } = await import("../src/components/AssetPreview");
afterEach(() => { cleanup(); window.document.body.innerHTML = ""; });

function Editor({ initial, onSave }: { initial: DraftForm; onSave: (draft: DraftForm) => void }) {
  const form = useForm<DraftForm>({ defaultValues: initial });
  return <form onSubmit={form.handleSubmit(onSave)}><BlockEditor form={form} /><button type="submit">Save draft</button></form>;
}

test("staff place uploaded images and ordered QR items, then repair unavailable references without losing captions", async () => {
  const user = userEvent.setup({ document: window.document as unknown as Document });
  const saved: DraftForm[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const branding = { id: "brand-1", name: "Campus logo", kind: "branding" };
  const image = { id: "image-1", name: "Campus photo", kind: "image" };
  const qr = { id: "qr-1", name: "Join QR", kind: "qr" };
  client.setQueryData(["assets"], [branding, image, qr]);
  const initial: DraftForm = { gatheringDate: "2034-05-21", composition: { cover: [{ type: "branding", assetId: "" }], flow: [{ type: "image", assetId: "" }, { type: "qr", items: [] }] } };
  const view = render(<QueryClientProvider client={client}><Editor initial={initial} onSave={(draft) => saved.push(draft)} /></QueryClientProvider>);
  await user.selectOptions(screen.getByRole("combobox", { name: "Branding image asset" }), branding.id);
  await user.selectOptions(screen.getByRole("combobox", { name: "Image asset" }), image.id);
  await user.click(screen.getByRole("button", { name: "Move to reading order" }));
  await user.click(screen.getByRole("button", { name: "Add QR code" }));
  await user.type(screen.getByRole("textbox", { name: "QR code 1 caption" }), "Join us");
  await user.type(screen.getByRole("spinbutton", { name: "QR code 1 size (mm)" }), "22");
  await user.selectOptions(screen.getByRole("combobox", { name: "QR image asset" }), qr.id);
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(saved.at(-1)?.composition.flow).toEqual([
    { type: "image", assetId: image.id },
    { type: "qr", items: [{ caption: "Join us", assetId: qr.id, size_mm: 22 }] },
    { type: "branding", assetId: branding.id },
  ]);

  view.unmount();
  client.setQueryData(["assets"], [image, { id: "qr-2", name: "New QR", kind: "qr" }, { id: "brand-2", name: "New logo", kind: "branding" }]);
  render(<QueryClientProvider client={client}><Editor initial={saved.at(-1)!} onSave={(draft) => saved.push(draft)} /></QueryClientProvider>);
  expect(screen.getAllByRole("status", { name: /Unavailable/ })).toHaveLength(2);
  expect(screen.getAllByText(/Unavailable image/).length).toBeGreaterThanOrEqual(2);
  expect((screen.getByRole("combobox", { name: "QR image asset" }) as HTMLSelectElement).value).toBe(qr.id);
  await user.selectOptions(screen.getByRole("combobox", { name: "QR image asset" }), "qr-2");
  await user.selectOptions(screen.getByRole("combobox", { name: "Branding image asset" }), "brand-2");
  await user.click(screen.getByRole("button", { name: "Save draft" }));
  expect(saved.at(-1)?.composition.flow).toEqual([
    { type: "image", assetId: image.id },
    { type: "qr", items: [{ caption: "Join us", assetId: "qr-2", size_mm: 22 }] },
    { type: "branding", assetId: "brand-2" },
  ]);
});

test("draft structure preview shows QR images and captions, but names deleted image references explicitly", () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["assets"], [
    { id: "image-1", name: "Photo", kind: "image" },
    { id: "qr-1", name: "Join QR", kind: "qr" },
  ]);
  render(<QueryClientProvider client={client}><AssetPreview block={{ type: "qr", items: [
    { assetId: "qr-1", caption: "Join", size_mm: 20 },
    { assetId: "removed-qr", caption: "Old link", size_mm: 30 },
  ] }} /><AssetPreview block={{ type: "branding", assetId: "removed-brand" }} /></QueryClientProvider>);
  expect(screen.getByRole("img", { name: "Join" }).getAttribute("src")).toBe("/api/assets/qr-1/image");
  expect(screen.getByText(/Unavailable QR image.*removed-qr/)).toBeDefined();
  expect(screen.getByText(/Unavailable Branding image.*removed-brand/)).toBeDefined();
  expect(screen.queryByRole("img", { name: /removed/ })).toBeNull();
});
