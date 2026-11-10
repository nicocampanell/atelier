// Adapted from Pond (MIT) apps/extension/sources/instagram/requests.ts @ deb305e
// Atelier: like detection removed (saves only).
const ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const SAVE_OPERATIONS = new Set([
  "usePolarisSaveMediaSaveMutation",
  "PolarisAPISavePostMutation",
  "usePolarisMediaSaveToCollectionAddMediaMutation",
]);

const SAVE_ROOT_FIELDS = new Set([
  "xig_media_save",
  "xig_media_collection_add_media",
]);

type HeaderReader = (name: string) => string | null;

function formParams(bodyStr: string | null): URLSearchParams | null {
  if (!bodyStr) return null;
  try {
    return new URLSearchParams(bodyStr);
  } catch {
    return null;
  }
}

function friendlyName(
  getHeader: HeaderReader,
  bodyStr: string | null,
): string | null {
  return (
    getHeader("x-fb-friendly-name") ??
    formParams(bodyStr)?.get("fb_api_req_friendly_name") ??
    null
  );
}

export function mediaIdToShortcode(id: string): string | null {
  try {
    const mediaId = String(id).split("_", 1)[0];
    if (!mediaId) return null;
    let n = BigInt(mediaId);
    let s = "";
    while (n > 0n) {
      s = ALPHABET[Number(n & 63n)] + s;
      n = n >> 6n;
    }
    return s || null;
  } catch {
    return null;
  }
}

export function isSaveMutation(
  getHeader: HeaderReader,
  bodyStr: string | null,
): boolean {
  const name = friendlyName(getHeader, bodyStr);
  if (name && SAVE_OPERATIONS.has(name)) return true;
  if (name && /unsave|remove/i.test(name)) return false;
  const root = getHeader("x-root-field-name");
  if (root && !/unsave|remove/i.test(root)) {
    if (SAVE_ROOT_FIELDS.has(root) || root.endsWith("__save")) return true;
  }
  if (bodyStr) {
    for (const op of SAVE_OPERATIONS) if (bodyStr.includes(op)) return true;
    if (
      /xdt_api__v1__web__save__media_id__save(?!_unsave)/.test(bodyStr) &&
      !/unsave/i.test(bodyStr)
    ) {
      return true;
    }
  }
  return false;
}

export function extractMediaIdFromBody(bodyStr: string | null): string | null {
  const variablesRaw = formParams(bodyStr)?.get("variables");
  if (!variablesRaw) return null;
  try {
    const vars = JSON.parse(variablesRaw);
    const candidate =
      vars.input?.media_id ??
      vars.media_id ??
      vars.mediaId ??
      vars.media?.id ??
      null;
    return candidate == null ? null : String(candidate);
  } catch {
    return null;
  }
}
