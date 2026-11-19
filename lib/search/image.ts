import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { getDataDir } from "../db";
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

/** A save's image ready for Jev: the uploaded file, else its public preview. Null when there is none or it can't be read. */
export async function loadSaveImage(
  save: { storagePath: string | null; mediaType: string | null; bytes: number | null; previewUrl: string | null },
  previewTimeoutMs = 3000,
): Promise<Uint8Array | null> {
  if (save.storagePath) {
    if (!save.bytes || save.bytes > 25 * 1024 * 1024 || !LOCAL_TYPES.includes(save.mediaType ?? "")) return null;
    const root = path.resolve(getDataDir(), "assets") + path.sep;
    const file = path.resolve(getDataDir(), save.storagePath);
    if (!file.startsWith(root)) return null;
    try { return await prepareJevImage(await readFile(file)); } catch { return null; }
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
