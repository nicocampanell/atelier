const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const TIMEOUT_MS = 15_000;

export type ImageResult =
  | { status: "available"; mimeType: string; data: string }
  | { status: "missing" | "unsupported" | "unavailable" | "too_large"; reason: string; httpStatus?: number };

function imageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(Buffer.from(bytes.subarray(0, 6)).toString("ascii"))) return "image/gif";
  if (bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

async function readImage(response: Response): Promise<ImageResult> {
  if (!response.ok) return { status: "unavailable", reason: `Image request failed (${response.status}).`, httpStatus: response.status };
  const type = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!["image/png", "image/jpeg", "image/gif", "image/webp"].includes(type)) {
    await response.body?.cancel();
    return { status: "unsupported", reason: "The asset is not a supported image." };
  }
  const size = Number(response.headers.get("content-length"));
  if (Number.isFinite(size) && size > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    return { status: "too_large", reason: "The image exceeds the 20 MiB inspection limit." };
  }
  if (!response.body) return { status: "unavailable", reason: "The image response was empty." };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        return { status: "too_large", reason: "The image exceeds the 20 MiB inspection limit." };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = Buffer.concat(chunks);
  const detected = imageType(bytes);
  if (!detected || detected !== type) return { status: "unsupported", reason: "Image bytes do not match the declared media type." };
  return { status: "available", mimeType: detected, data: bytes.toString("base64") };
}

/** Only resolve Atelier-owned asset paths and the configured Supabase signed storage target. */
export async function inspectImage(previewUrl: string | null, saveId: string, apiUrl: string, supabaseUrl: string, token: string): Promise<ImageResult> {
  if (!previewUrl) return { status: "missing", reason: "This save has no preview image." };
  let asset: URL;
  let api: URL;
  let storage: URL;
  try {
    api = new URL(apiUrl);
    storage = new URL(supabaseUrl);
    asset = new URL(previewUrl, api);
  } catch {
    return { status: "unsupported", reason: "The preview URL is invalid." };
  }
  const isInternalAsset = asset.origin === api.origin && /^\/api\/assets\/[^/]+$/.test(asset.pathname) && !asset.search && !asset.hash && !asset.username && !asset.password;
  if (!isInternalAsset) {
    // The API resolves the save under the user's identity and applies its own safe-fetch policy.
    asset = new URL(`/api/saves/${encodeURIComponent(saveId)}/preview`, api);
  }
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(asset, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual", signal });
    if (response.status === 404 && !isInternalAsset) {
      return { status: "unavailable", reason: "The preview is missing or this Atelier API does not support saved preview retrieval yet." };
    }
    if (response.status === 413) return { status: "too_large", reason: "The image exceeds the Atelier preview size limit." };
    if (response.status === 415) return { status: "unsupported", reason: "The preview is not a supported image." };
    if (response.status >= 300 && response.status < 400) {
      if (!isInternalAsset) return { status: "unavailable", reason: "The Atelier preview endpoint returned an unexpected redirect." };
      const location = response.headers.get("location");
      if (!location) return { status: "unavailable", reason: "The asset redirect has no destination." };
      const target = new URL(location, asset);
      if (target.origin !== storage.origin || target.username || target.password || !target.pathname.startsWith("/storage/v1/object/sign/")) {
        return { status: "unavailable", reason: "The asset redirect did not point to the configured Supabase Storage." };
      }
      const downloaded = await fetch(target, { redirect: "manual", signal });
      return await readImage(downloaded);
    }
    return await readImage(response);
  } catch {
    return { status: "unavailable", reason: "Could not retrieve the image from Atelier Storage." };
  }
}
