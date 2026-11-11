import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useAssets() {
  return useQuery({ queryKey: ["assets"], queryFn: async () => {
    const response = await api.api.assets.get();
    if (response.error || !response.data || !("assets" in response.data)) throw new Error("Could not load images. Try again.");
    return response.data.assets;
  }, retry: false });
}

export function AssetPicker({ value, onChange, kind }: { value?: string; onChange: (value: string) => void; kind: "branding" | "qr" | "image" }) {
  const assets = useAssets();
  if (assets.isPending) return <p>Loading images…</p>;
  if (assets.isError) return <p role="alert" className="error">{assets.error.message} <button type="button" onClick={() => assets.refetch()}>Try again</button></p>;
  const choices = (assets.data ?? []).filter((asset) => asset.kind === kind || kind === "branding" && asset.kind === "image");
  const missing = !!value && !choices.some((asset) => asset.id === value);
  return <div className="asset-picker">
    {missing && <p role="status" aria-label={`Unavailable image ${value}`} className="field-warning">Unavailable image ({value}). This draft can still be saved. Select another image to repair the reference.</p>}
    <select aria-label={kind === "qr" ? "QR image asset" : kind === "branding" ? "Branding image asset" : "Image asset"} value={value ?? ""} onChange={(event) => onChange(event.target.value)}><option value="">No image selected</option>{missing && <option value={value}>Unavailable image ({value})</option>}{choices.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select>
  </div>;
}
