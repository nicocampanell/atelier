import { downloadAssetBytes } from "../assets";
import { safeFetch } from "../fetch-safe";

/** Jev experimental image API byte ceiling (no Workers resize yet). */
export const JEV_MAX_BYTES = 2 * 1024 * 1024;

/** Magic-byte sniff for formats Jev accepts without conversion. */
export function jevFormat(bytes: Uint8Array): "jpg" | "png" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  return null; // webp/gif need convert — skip until a real Jev rejection forces WASM resize
}

/** Pass through when already within Jev limits; no sharp/WASM resize. */
export function prepareJevImage(bytes: Uint8Array): Uint8Array | null {
  if (!bytes.length || bytes.length > JEV_MAX_BYTES) return null;
  return jevFormat(bytes) ? bytes : null;
}

const LOCAL_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** A save's image ready for Jev: uploaded Storage object, else public preview. Null when none / over limit / unsupported. */
export async function loadSaveImage(
  userId: string,
  save: { storagePath: string | null; mediaType: string | null; bytes: number | null; previewUrl: string | null },
  previewTimeoutMs = 3000,
): Promise<Uint8Array | null> {
  if (save.storagePath) {
    if (!save.bytes || save.bytes > JEV_MAX_BYTES || !LOCAL_TYPES.includes(save.mediaType ?? "")) return null;
    try {
      const raw = await downloadAssetBytes(userId, save.storagePath);
      return raw ? prepareJevImage(raw) : null;
    } catch {
      return null;
    }
  }
  if (!save.previewUrl || !/^https?:\/\//i.test(save.previewUrl)) return null;
  try {
    const preview = await safeFetch(save.previewUrl, { maxBytes: JEV_MAX_BYTES, timeoutMs: previewTimeoutMs, maxRedirects: 3 });
    if (preview.status < 200 || preview.status >= 300 || !preview.contentType.toLowerCase().startsWith("image/")) return null;
    return prepareJevImage(preview.body);
  } catch {
    return null;
  }
}
