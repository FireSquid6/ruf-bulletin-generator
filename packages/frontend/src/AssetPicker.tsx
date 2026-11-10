import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export function AssetPicker({ value, onChange, kind }: { value?: string; onChange: (value: string) => void; kind: "branding" | "qr" | "image" }) {
  const assets = useQuery({ queryKey: ["assets"], queryFn: async () => {
    const response = await api.api.assets.get();
    if (response.error || !response.data || !("assets" in response.data)) throw new Error("Could not load images. Try again.");
    return response.data.assets;
  }, retry: false });
  if (assets.isPending) return <p>Loading images…</p>;
  if (assets.isError) return <p role="alert" className="error">{assets.error.message} <button type="button" onClick={() => assets.refetch()}>Try again</button></p>;
  const choices = (assets.data ?? []).filter((asset) => asset.kind === kind || kind === "branding" && asset.kind === "image");
  return <select aria-label={kind === "qr" ? "QR image asset" : kind === "branding" ? "Branding image asset" : "Image asset"} value={value ?? ""} onChange={(event) => onChange(event.target.value)}><option value="">No image selected</option>{value && !choices.some((asset) => asset.id === value) && <option value={value}>Unavailable image ({value})</option>}{choices.map((asset) => <option value={asset.id} key={asset.id}>{asset.name}</option>)}</select>;
}
