// Adapted from Pond (MIT) apps/extension/utils/bridge.ts @ deb305e
// Atelier: the bridge is pure validation here; the content script does the messaging.
// Pond's version also forwarded logs and read Pond settings; neither applies.
import { type CaptureMessage, type CaptureRequest, HOOK_CHANNEL, type SourceId } from "../lib/contracts";

const SOURCE_IDS: readonly SourceId[] = ["pinterest", "arena", "twitter", "instagram"];

/** Serialized HookEvent size limit. */
export const MAX_PAYLOAD_BYTES = 32 * 1024;

const PAGE_HOSTS: Record<SourceId, readonly string[]> = {
  pinterest: ["pinterest.com"],
  arena: ["are.na"],
  twitter: ["x.com", "twitter.com"],
  instagram: ["instagram.com"],
};

function isRec(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function optText(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : null;
}

function hostBelongs(source: SourceId, url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return PAGE_HOSTS[source].some((h) => host === h || host.endsWith(`.${h}`));
}

function cleanRequest(raw: unknown, source: SourceId, enforcePageHost: boolean): CaptureRequest | null {
  if (!isRec(raw)) return null;
  const title = optText(raw.title);
  if (title === null) return null;
  const withTitle = title === undefined ? {} : { title };
  if (raw.kind === "page") {
    const url = httpUrl(raw.url);
    if (!url || (enforcePageHost && !hostBelongs(source, url))) return null;
    return { kind: "page", url, ...withTitle };
  }
  if (raw.kind === "image") {
    const imageUrl = httpUrl(raw.imageUrl);
    const pageUrl = httpUrl(raw.pageUrl);
    if (!imageUrl || !pageUrl || (enforcePageHost && !hostBelongs(source, pageUrl))) return null;
    return { kind: "image", imageUrl, pageUrl, ...withTitle };
  }
  // Hooks never take screenshots, and "page" notes are user-typed only.
  return null;
}

export interface BridgeEvent {
  source: unknown;
  data: unknown;
}

/**
 * Validates one window "message" event and returns the CaptureMessage to forward, or null.
 * `expectedSource`, when given, is the site the content script runs on; an event claiming another
 * site, or a page URL off that site, is dropped (any script on the page can post messages).
 */
export function bridgeMessage(
  event: BridgeEvent,
  win: unknown,
  expectedSource?: SourceId,
): CaptureMessage | null {
  if (event.source !== win) return null;
  const data = event.data;
  if (!isRec(data) || data.channel !== HOOK_CHANNEL) return null;
  const source = data.source;
  if (typeof source !== "string" || !SOURCE_IDS.includes(source as SourceId)) return null;
  const id = source as SourceId;
  if (expectedSource && id !== expectedSource) return null;
  if (typeof data.dedupeKey !== "string" || data.dedupeKey.length === 0 || data.dedupeKey.length > 200) return null;

  let size: number;
  try {
    size = new TextEncoder().encode(JSON.stringify(data)).length;
  } catch {
    return null;
  }
  if (size > MAX_PAYLOAD_BYTES) return null;

  const request = cleanRequest(data.request, id, expectedSource !== undefined);
  if (!request) return null;
  return {
    type: "atelier.capture",
    request,
    origin: { type: "hook", source: id },
    dedupeKey: data.dedupeKey,
  };
}

export function createRateLimit(limit: number, windowMs: number): (now: number) => boolean {
  const recent: number[] = [];
  return (now) => {
    while (recent.length > 0 && now - (recent[0] ?? 0) >= windowMs) recent.shift();
    if (recent.length >= limit) return false;
    recent.push(now);
    return true;
  };
}
