import type { Block } from "./BlockEditor";
import { blockLabel } from "./BlockEditor";
import { useAssets } from "./AssetPicker";

// A structural preview, not proof that the PDF generator can fit the image.
export function AssetPreview({ block }: { block: Block }) {
  const assets = useAssets();
  function image(id: string | undefined, label: string, kind: string, sizeMm?: number) {
    if (!id) return <p>{label}: No image selected</p>;
    if (assets.isPending) return <p>Loading image…</p>;
    if (assets.isError) return <p className="field-warning">Could not check image availability.</p>;
    if (!assets.data?.some((asset) => asset.id === id && (asset.kind === kind || kind === "branding" && asset.kind === "image"))) {
      return <p className="field-warning">Unavailable {kind === "qr" ? "QR image" : kind === "branding" ? "Branding image" : "image"} ({id}){kind === "qr" && label ? ` · ${label}` : ""}</p>;
    }
    return <img src={`/api/assets/${id}/image`} alt={label} style={kind === "qr" && sizeMm && sizeMm > 0 ? { width: `${sizeMm}mm` } : undefined} />;
  }
  if (block.type === "qr") return <div className="preview-block"><strong>QR codes</strong>{block.items?.map((item, index) => <div className="preview-qr" key={index}>{image(item.assetId, item.caption || `QR code ${index + 1}`, "qr", item.size_mm)}{item.caption && <p>{item.caption}</p>}</div>)}</div>;
  return <div className="preview-block">{image(block.assetId, blockLabel(block), block.type)}</div>;
}
