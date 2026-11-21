// Adapted from Pond (MIT) apps/extension/sources/pinterest/save-request.ts @ deb305e
import { at, type JsonValue, nonEmpty, parseJsonValue } from "../_lib/json";

function decodeDataParam(encoded: string): JsonValue | null {
  let decoded = encoded;
  try {
    decoded = decodeURIComponent(encoded.replace(/\+/g, " ")); // form encoding: "+" is a space
  } catch {
    /* already decoded */
  }
  return parseJsonValue(decoded) ?? parseJsonValue(encoded);
}

function bodyJson(body: string | null): JsonValue | null {
  if (!body) return null;
  if (body.startsWith("data=")) return decodeDataParam(body.slice(5).split("&")[0] ?? "");
  if (body.includes("&data=")) {
    const m = body.match(/(?:^|&)data=([^&]+)/);
    return m?.[1] ? decodeDataParam(m[1]) : null;
  }
  if (body.startsWith("{")) return parseJsonValue(body);
  return null;
}

function options(json: JsonValue): JsonValue | undefined {
  return at(json, "options") ?? at(json, "data", "options") ?? json;
}

export function pinIdFromBody(body: string | null): string | null {
  const json = bodyJson(body);
  if (!json) return null;
  const opts = options(json);
  const id = at(opts, "pin_id") ?? at(opts, "id") ?? at(opts, "source_pin_id") ?? at(opts, "sourceId");
  return id ? String(id) : null;
}

/** The title the user typed in the save dialog, when the request carries one. */
export function pinTitleFromBody(body: string | null): string | undefined {
  const json = bodyJson(body);
  return json ? nonEmpty(at(options(json), "title")) : undefined;
}
