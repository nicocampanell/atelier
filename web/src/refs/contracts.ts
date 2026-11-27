// Contract for user-added references. Data layer: src/refs/*.ts + src/api/client.ts.
// UI layer imports only what is declared here. Change only via the orchestrator.

import type { Reference } from '../types';

/* ------------------------------------------------------------------ */
/* Reference store — src/refs/store.ts                                */
/* ------------------------------------------------------------------ */
/*
 * Module-level singleton, reactive via useSyncExternalStore.
 * - Lists saved references. Old sample cards remain resolvable by ID for existing boards.
 *   Saved metadata hydrates asynchronously from IndexedDB (store "refs", one record
 *   per reference; localStorage "atelier.refs.v1" only as a fallback and one-time migration
 *   source). `refsReady` resolves when it is loaded; main.tsx renders the app after that so
 *   boards.ts validation on load can see user ref ids.
 * - Image blobs live in IndexedDB; after hydrate only THUMBNAIL object URLs are created and
 *   patched into `thumbSrc` (until then it is undefined → UI shows `color`). `src` stays
 *   undefined until `ensureOriginal(id)` reads the original and patches it in.
 * - User ids are "u-" + uuid; never collide with seed ids. Seed refs cannot be removed/updated.
 * - Persistence: metadata only (no object URLs), debounced 250 ms; only changed records are written.
 *
 *   export const refsReady: Promise<void>                // saved metadata loaded; never rejects
 *   export function ensureOriginal(id): Promise<string | undefined>   // full-size URL, lazily loaded
 *
 *   export const refsStore: RefsStore
 *   export function useReferences(): RefsSnapshot      // re-renders on change
 *   export function useReference(id: string): Reference | undefined
 */
export interface RefsSnapshot {
  /** User-added newest first, followed by seeds. Stable array identity between changes. */
  list: readonly Reference[];
  byId: Readonly<Record<string, Reference>>;
}

export interface RefsStore {
  getSnapshot(): RefsSnapshot;
  subscribe(listener: () => void): () => void;
  get(id: string): Reference | undefined;
  has(id: string): boolean;
}

/* ------------------------------------------------------------------ */
/* Add / remove flows — src/refs/actions.ts                            */
/* ------------------------------------------------------------------ */

export type AddResult = { ok: true; ref: Reference } | { ok: false; error: string };

/** Accepted image MIME types and the size cap (bytes). */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/*
 *   export function validateImageFile(file: { type: string; size: number; name: string }):
 *     { ok: true } | { ok: false; error: string }
 *     Messages: "“name” isn't a supported image (PNG, JPEG, WebP, GIF or AVIF)." /
 *               "“name” is larger than 25 MB."
 *
 *   export function addImageFile(file: File): AddResult
 *     Synchronous: validates, then immediately adds a reference with status "saving",
 *     kind "image", title = file name without extension, source "Upload", tags ["added"],
 *     userAdded true, w/h = a provisional 240×180 (updated once decoded), and returns it.
 *     Async continuation: decode (createImageBitmap), resize (original ≤1600 px long side,
 *     thumb ≤640 px), dominant colour, store both blobs in IndexedDB, set w/h so the long
 *     side is 240 world px, set src (original) + thumbSrc (thumb) object URLs, status "ready".
 *     On failure: status "failed" + error. Then, if the backend is connected, sync (below).
 *
 *   export function addLink(url: string): AddResult
 *     Normalises (adds https:// if missing), validates http(s); kind "link", title = hostname,
 *     source = hostname, url, body = url, tags ["added"], status "saving" → "ready" locally
 *     (immediately, next tick). If connected, sync and fill title/preview from the backend.
 *
 *   export function addNote(body: string, title?: string): AddResult
 *     kind "note", status "ready", source "Note", tags ["added"], w 240, h from text length
 *     (130–260).
 *
 *   export function updateNote(id: string, patch: { title?: string; body?: string }): void
 *   export function retry(id: string): void      // re-runs whatever failed (local processing or sync)
 *
 *   export function removeRef(id: string): { undo(): void; commit(): void } | null
 *     Hides the reference immediately (removed from snapshot). undo() restores it.
 *     commit() (call when the Undo window closes) deletes blobs from IndexedDB, revokes
 *     object URLs and, if synced, DELETE /api/saves/:id. Seeds → null.
 *     The UI is responsible for also calling boards.removeItemsOfRef / restoreItems.
 *
 *   export function isUserRefId(id: string): boolean
 */

/* ------------------------------------------------------------------ */
/* Backend connection — src/api/client.ts (+ src/refs/backend.ts hook) */
/* ------------------------------------------------------------------ */
/*
 * Everything works with no backend. Token in localStorage "atelier-token"; never logged,
 * never shown again after entry, never put in a URL. Requests go to same-origin "/api/…"
 * (Vite dev proxy → VITE_API_TARGET || http://localhost:3300).
 *
 *   export type BackendStatus = 'off' | 'checking' | 'connected' | 'unreachable' | 'unauthorized'
 *   export function useBackendStatus(): BackendStatus
 *   export async function connectBackend(token: string): Promise<BackendStatus>
 *     Saves the token, checks GET /api/health and an authenticated GET /api/saves?limit=1.
 *   export function disconnectBackend(): void
 */
export type BackendStatus = 'off' | 'checking' | 'connected' | 'unreachable' | 'unauthorized';
