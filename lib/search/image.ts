import sharp from "sharp";
import { downloadAssetBytes } from "../assets";
import { safeFetch } from "../fetch-safe";

/** Prepare a local image for Jev's experimental image API. */
export async function prepareJevImage(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Decode limits protect the server from oversized or malformed images.
    const scaled = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize({ width: 1568, height: 1568, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 80, progressive: false }).toBuffer({ resolveWithObject: true });
    const extraX = Math.max(0, 280 - scaled.info.width);
    const extraY = Math.max(0, 280 - scaled.info.height);
    const output = await sharp(scaled.data).extend({
      left: Math.floor(extraX / 2), right: Math.ceil(extraX / 2),
      top: Math.floor(extraY / 2), bottom: Math.ceil(extraY / 2), background: "#ffffff",
    }).jpeg({ quality: 75, progressive: false }).toBuffer();
    return output.length <= 2 * 1024 * 1024 ? output : null;
  } catch {
    return null;
  }
}

const LOCAL_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** A save's image ready for Jev: uploaded Storage object, else public preview. Null when none / unreadable. */
export async function loadSaveImage(
  userId: string,
  save: { storagePath: string | null; mediaType: string | null; bytes: number | null; previewUrl: string | null },
  previewTimeoutMs = 3000,
): Promise<Uint8Array | null> {
  if (save.storagePath) {
    if (!save.bytes || save.bytes > 25 * 1024 * 1024 || !LOCAL_TYPES.includes(save.mediaType ?? "")) return null;
    try {
      const raw = await downloadAssetBytes(userId, save.storagePath);
      return raw ? await prepareJevImage(raw) : null;
    } catch {
      return null;
    }
  }
  if (!save.previewUrl || !/^https?:\/\//i.test(save.previewUrl)) return null;
  try {
    const preview = await safeFetch(save.previewUrl, { maxBytes: 5 * 1024 * 1024, timeoutMs: previewTimeoutMs, maxRedirects: 3 });
    if (preview.status < 200 || preview.status >= 300 || !preview.contentType.toLowerCase().startsWith("image/")) return null;
    return await prepareJevImage(preview.body);
  } catch {
    return null;
  }
}
