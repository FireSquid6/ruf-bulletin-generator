import { expect, test } from "bun:test";
import sharp from "sharp";
import { assetLimit, validateAsset } from "../src/assets";

test("asset formats are detected by the image library and retain original bytes", async () => {
  for (const [format, mimeType] of [["png", "image/png"], ["jpeg", "image/jpeg"], ["gif", "image/gif"], ["webp", "image/webp"]] as const) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).toFormat(format).toBuffer();
    const result = await validateAsset(" Test ", "image", mimeType, bytes);
    expect(result).toMatchObject({ name: "Test", mimeType, size: bytes.length });
    expect(result.bytes).toBe(bytes);
    await expect(validateAsset("Test", "qr", mimeType === "image/png" ? "image/jpeg" : "image/png", bytes)).rejects.toMatchObject({ status: 415 });
  }
});

test("asset validation rejects forged headers, unsupported types and size violations", async () => {
  for (const [bytes, mimeType] of [
    [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), "image/png"],
    [Buffer.from("GIF89a"), "image/gif"],
    [Buffer.from("RIFF0000WEBP"), "image/webp"],
    [Buffer.from("not an image"), "image/jpeg"],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>'), "image/svg+xml"],
  ] as const) {
    await expect(validateAsset("Test", "image", mimeType, bytes)).rejects.toMatchObject({ status: 415 });
  }
  await expect(validateAsset("Test", "image", "image/png", Buffer.alloc(0))).rejects.toMatchObject({ status: 400 });
  await expect(validateAsset("Test", "image", "image/png", Buffer.alloc(assetLimit + 1))).rejects.toMatchObject({ status: 413 });
});
