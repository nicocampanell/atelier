// Adapted from Pond (MIT) apps/extension/utils/json.ts @ deb305e
// Atelier: zod-free rewrite of Pond's JSON helpers (page hooks must never throw).

export interface JsonRecord {
  [key: string]: JsonValue;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | JsonRecord;

export function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asText(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A non-empty string or a number rendered as a string (ids arrive as either). */
export function asId(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

export function at(value: JsonValue | undefined, ...path: string[]): JsonValue | undefined {
  let current = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

export function parseJsonValue(text: string | null): JsonValue | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    return null;
  }
}

export function parseJsonRecord(text: string | null): JsonRecord | null {
  const value = parseJsonValue(text);
  return isRecord(value) ? value : null;
}

/** First path (in order) that holds an http(s) URL string. */
export function firstHttpUrl(value: JsonValue | undefined, paths: string[][]): string | undefined {
  for (const path of paths) {
    const candidate = asText(at(value, ...path));
    if (candidate && /^https?:\/\//i.test(candidate)) return candidate;
  }
  return undefined;
}

export function nonEmpty(value: JsonValue | undefined): string | undefined {
  const text = asText(value)?.trim();
  return text ? text : undefined;
}

export function asRecordOrNull(value: JsonValue | undefined): JsonRecord | null {
  return isRecord(value) ? value : null;
}
