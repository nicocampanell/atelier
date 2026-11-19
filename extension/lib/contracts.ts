// Internal contracts for the Atelier browser extension.
// Shapes adapted from Pond's apps/extension (MIT, github.com/raphaelsalaja/pond @ deb305e).
// Owned by the orchestrator: workers do not change this file; ask instead.
//
// Ownership:
//   Worker B (core)  — everything under extension/ except the paths owned by Worker C.
//   Worker C (hooks) — extension/sources/**, extension/entrypoints/hooks.content.ts,
//                      extension/entrypoints/hooks-main.content.ts, extension/utils/bridge.ts.
// The only coupling between them is this file.

/** What the user (or a site hook) asked to save. */
export type CaptureRequest =
  | {
      kind: "page";
      url: string;
      title?: string;
      note?: string;
    }
  | {
      /** A specific image on a page. Core fetches the bytes and uploads them (never sends cookies to Atelier). */
      kind: "image";
      imageUrl: string;
      /** Page the image was found on. */
      pageUrl: string;
      title?: string;
    }
  | {
      /** Screenshot of the visible tab, optionally cropped to a CSS-pixel rect of the viewport. */
      kind: "screenshot";
      pageUrl: string;
      title?: string;
      rect?: { x: number; y: number; w: number; h: number; dpr: number };
    };

/** Where a capture came from; used for the toast copy and for de-duplication of hook events. */
export type CaptureOrigin =
  | { type: "toolbar" }
  | { type: "shortcut" }
  | { type: "menu" }
  | { type: "popup" }
  | { type: "hook"; source: SourceId };

/** Sites with bookmark hooks in this release. */
export type SourceId = "pinterest" | "arena" | "twitter" | "instagram";

/**
 * Truthful client-side lifecycle shown in the toast and popup.
 *  sending    → request in flight (no server ack yet)
 *  saved      → server durably accepted it (Save.status "accepted" | "processing"); NOT "done"
 *  ready      → Save.status "ready"
 *  failed     → server or network refused; `message` is human-readable; retryable when `retry` is true
 *  duplicate  → saved, but Save.duplicateOf was set (still a success)
 *  signed-out → no access token; nothing was sent
 */
export type CaptureState =
  | { state: "sending"; captureId: string }
  | { state: "saved"; captureId: string; saveId: string; projectName: string | null }
  | { state: "ready"; captureId: string; saveId: string; title: string; projectName: string | null }
  | { state: "duplicate"; captureId: string; saveId: string; projectName: string | null }
  | { state: "failed"; captureId: string; message: string; retry: boolean }
  | { state: "signed-out"; captureId: string };

/** Message from a content script (hooks bridge, overlay) to the background worker. */
export interface CaptureMessage {
  type: "atelier.capture";
  request: CaptureRequest;
  origin: CaptureOrigin;
  /**
   * Stable key for the user action, e.g. "pinterest:pin:12345". The background drops a second
   * message with the same dedupeKey within 10 s and reuses it as the HTTP Idempotency-Key seed.
   */
  dedupeKey?: string;
}

/** Background → content script (overlay) progress updates for one capture. */
export interface CaptureStateMessage {
  type: "atelier.capture-state";
  update: CaptureState;
}

/** Background replies to a CaptureMessage with the first state (normally "sending" or "signed-out"). */
export type CaptureReply = CaptureState;

/**
 * Main-world hook → isolated bridge, via window.postMessage. The bridge (Worker C) validates
 * `source` against SourceId, `channel` exactly, and that request URLs are http(s), then sends
 * a CaptureMessage with origin {type:"hook", source}.
 */
export interface HookEvent {
  channel: "atelier.hook.v1";
  source: SourceId;
  request: CaptureRequest;
  dedupeKey: string;
}

/** Persisted in browser.storage.local under "atelier.settings". Tokens are never logged or sent to content scripts. */
export interface ExtensionSettings {
  /** e.g. "http://localhost:3000" — no trailing slash. */
  serverUrl: string;
  accessToken: string | null;
  refreshToken: string | null;
  email: string | null;
  /** Project new captures go to; null = library only (no placement). */
  projectId: string | null;
  /** Per-source hook toggles; default all true. */
  hooks: Record<SourceId, boolean>;
}

/** Local default. Production builds: set `WXT_API_URL` (e.g. https://atelier-api.<account>.workers.dev). */
export const DEFAULT_SERVER_URL =
  (import.meta.env.WXT_API_URL as string | undefined)?.replace(/\/+$/, "") || "http://localhost:3000";
export const SETTINGS_KEY = "atelier.settings";
export const HOOK_CHANNEL = "atelier.hook.v1";
