// Adapted from Pond (MIT) apps/extension/utils/intercept.ts @ deb305e
// Atelier: replaces Pond's capture()/emit(); posts a HookEvent for the isolated-world bridge.
import { type CaptureRequest, HOOK_CHANNEL, type HookEvent, type SourceId } from "../../lib/contracts";

/** The page may fire the same save more than once (click + retry); one user action, one event. */
const DEDUPE_MS = 4000;
const recent = new Map<string, number>();

export function emitHook(
  source: SourceId,
  request: CaptureRequest,
  dedupeKey: string,
  now: number = Date.now(),
): boolean {
  const previous = recent.get(dedupeKey);
  if (previous !== undefined && now - previous < DEDUPE_MS) return false;
  for (const [key, at] of recent) if (now - at >= DEDUPE_MS) recent.delete(key);
  recent.set(dedupeKey, now);
  const event: HookEvent = { channel: HOOK_CHANNEL, source, request, dedupeKey };
  window.postMessage(event, "*");
  return true;
}

export function resetEmitted(): void {
  recent.clear();
}

/** Page capture when no image was found in the site's own traffic, image capture otherwise. */
export function itemRequest(pageUrl: string, imageUrl: string | undefined, title: string | undefined): CaptureRequest {
  if (imageUrl) return { kind: "image", imageUrl, pageUrl, ...(title ? { title } : {}) };
  return { kind: "page", url: pageUrl, ...(title ? { title } : {}) };
}
