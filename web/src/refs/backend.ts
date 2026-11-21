// Backend connection status and the sync of locally processed references to the backend.
// Everything works without a backend: items simply stay `sync: 'local'`.

import { useSyncExternalStore } from 'react';
import {
  ApiClientError,
  deleteSave,
  fetchAsset,
  getSave,
  health,
  listSaves,
  retrySave,
  saveLink,
  uploadImage,
  writeToken,
  type Save,
} from '../api/client';
import type { BackendStatus } from './contracts';
import { blobStore } from './idb';
import { LINK_SIZE, refsInternal } from './store';

export const POLL_INTERVAL_MS = 1000;
export const POLL_MAX_ATTEMPTS = 90;

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

// Nothing from api/client.ts may run at import time: client.ts re-exports from this module.
const hasStoredToken = (() => {
  try {
    return !!globalThis.localStorage?.getItem('atelier-token');
  } catch {
    return false;
  }
})();
let status: BackendStatus = hasStoredToken ? 'checking' : 'off';
const listeners = new Set<() => void>();
let checkId = 0;
/** Bumped on disconnect so in-flight syncs stop. */
let epoch = 0;
const syncing = new Set<string>();
const deleting = new Set<string>();
export function markServerDeleting(id: string): void { deleting.add(id); }
export function cancelServerDeleting(id: string): void { deleting.delete(id); }

function setStatus(next: BackendStatus): void {
  if (next === status) return;
  status = next;
  for (const l of [...listeners]) l();
}

export function getBackendStatus(): BackendStatus {
  return status;
}

export function useBackendStatus(): BackendStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => status,
    () => status,
  );
}

async function checkConnection(): Promise<BackendStatus> {
  const id = ++checkId;
  const done = (s: BackendStatus) => {
    if (id === checkId) setStatus(s);
    return id === checkId ? s : status;
  };
  setStatus('checking');
  try {
    await health();
  } catch {
    return done('unreachable');
  }
  try {
    await listSaves(1);
  } catch (e) {
    return done(e instanceof ApiClientError && (e.status === 401 || e.status === 403) ? 'unauthorized' : 'unreachable');
  }
  const result = done('connected');
  if (result === 'connected') void refreshServerSaves();
  return result;
}

let refreshRunning: Promise<void> | null = null;
/** Coalesce refreshes so an older listing cannot undo a newer reconciliation. */
export function refreshServerSaves(): Promise<void> {
  if (refreshRunning) return refreshRunning;
  refreshRunning = loadServerSaves().finally(() => { refreshRunning = null; });
  return refreshRunning;
}

async function loadServerSaves(): Promise<void> {
  const myEpoch = epoch;
  const before = refsInternal.allUsers().filter((ref) => ref.serverId).map((ref) => ({ id: ref.id, serverId: ref.serverId! }));
  const seen = new Set<string>();
  try {
    const saves: Save[] = [];
    let cursor: string | undefined;
    do {
      const page = await listSaves(100, cursor);
      if (myEpoch !== epoch) return;
      saves.push(...page.saves);
      cursor = page.next ?? undefined;
    } while (cursor);
    // add() prepends: import oldest first so recent captures remain at the top.
    for (const save of saves.reverse()) {
      seen.add(save.id);
      if (deleting.has(save.id)) continue;
      const existing = refsInternal.allUsers().find((r) => r.serverId === save.id);
      if (existing && (refsInternal.isHidden(existing.id) || syncing.has(existing.id))) continue;
      const kind = save.kind === 'image' ? 'image' : save.kind === 'note' ? 'note' : 'link';
      const id = existing?.id ?? `u-server-${save.id}`;
      const status = save.status === 'ready' ? 'ready' : save.status === 'failed' ? 'failed' : 'saving';
      const sync = save.status === 'ready' ? 'synced' : save.status === 'failed' ? 'failed' : 'syncing';
      const source = save.sourceUrl ? (() => { try { return new URL(save.sourceUrl).hostname.replace(/^www\./, ''); } catch { return 'Saved'; } })() : 'Saved';
      const serverTags = save.tags ?? [];
      if (existing) {
        const tags = serverTags.some((t) => !existing.tags.includes(t)) ? [...new Set([...existing.tags, ...serverTags])] : existing.tags;
        refsInternal.update(id, { title: save.title || existing.title, source, tags, body: save.description ?? undefined, url: save.sourceUrl ?? undefined, status, sync, error: save.status === 'failed' ? save.error ?? 'Processing failed.' : undefined });
      } else {
        refsInternal.add({ id, kind, title: save.title || 'Untitled', source, tags: serverTags, color: '#e9e6e0', w: LINK_SIZE.w, h: kind === 'image' ? 200 : LINK_SIZE.h, body: save.description ?? undefined, url: save.sourceUrl ?? undefined, serverId: save.id, status, sync, error: save.status === 'failed' ? save.error ?? 'Processing failed.' : undefined });
      }
      if (save.previewUrl && !refsInternal.getAny(id)?.thumbSrc) void fetchThumbnail(id, save).catch(() => {});
    }
    if (myEpoch !== epoch) return;
    for (const ref of before) {
      if (!seen.has(ref.serverId) && !deleting.has(ref.serverId) && !refsInternal.isHidden(ref.id) && !syncing.has(ref.id)) {
        refsInternal.purge(ref.id);
        void blobStore.delete(ref.id);
      }
    }
    for (const id of deleting) if (!seen.has(id)) deleting.delete(id);
  } catch { /* A failed or incomplete listing must never remove local references. */ }
}

export async function connectBackend(token: string): Promise<BackendStatus> {
  const t = token.trim();
  if (!t) {
    disconnectBackend();
    return 'off';
  }
  writeToken(t);
  return checkConnection();
}

export function disconnectBackend(): void {
  writeToken(null);
  checkId++;
  epoch++;
  for (const id of syncing) {
    refsInternal.update(id, { sync: 'failed', error: 'Not synced: disconnected from the backend.' });
  }
  syncing.clear();
  setStatus('off');
}

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function failMessage(e: unknown): string {
  if (e instanceof ApiClientError) {
    if (e.status === 401 || e.status === 403) {
      setStatus('unauthorized');
      return "Not synced: the backend didn't accept the access token.";
    }
    // A dev proxy (or gateway) in front of a stopped backend answers 502/503/504 instead of failing the fetch.
    if (e.code === 'network_error' || e.status === 502 || e.status === 503 || e.status === 504) {
      if (status === 'connected') setStatus('unreachable');
      return "Not synced: couldn't reach the backend.";
    }
    return `Not synced: ${e.message}`;
  }
  return 'Not synced: something went wrong.';
}

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg' };

/** Waits for the backend to finish processing a save, polling once a second for up to 90 s. */
async function pollSave(initial: Save, id: string, myEpoch: number): Promise<Save | null> {
  let save = initial;
  for (let attempt = 0; ; attempt++) {
    if (save.status === 'ready' || save.status === 'failed') return save;
    if (attempt >= POLL_MAX_ATTEMPTS) return null;
    await sleep(POLL_INTERVAL_MS);
    if (epoch !== myEpoch) return null;
    save = await getSave(id);
  }
}

async function fetchThumbnail(id: string, save: Save): Promise<void> {
  const preview = save.previewUrl;
  if (!preview) return;
  let blob: Blob | null = null;
  const asset = /^\/api\/assets\/([^/?#]+)/.exec(preview);
  if (asset) {
    blob = await fetchAsset(decodeURIComponent(asset[1]));
  } else if (/^https?:\/\//i.test(preview)) {
    // Third-party image: never send the access token there.
    try {
      const res = await fetch(preview, { credentials: 'omit' });
      if (res.ok) blob = await res.blob();
    } catch {
      /* CORS or network: no thumbnail */
    }
  }
  if (!refsInternal.getAny(id)) return;
  if (!blob || !blob.type.startsWith('image/')) {
    // Hosts without CORS (e.g. Pinterest's i.pinimg.com) can't be fetched but still render in an <img>.
    if (!asset && /^https?:\/\//i.test(preview)) refsInternal.update(id, { thumbSrc: preview });
    return;
  }
  await blobStore.put(id, 'thumb', blob);
  refsInternal.setHasBlob(id, true);
  const url = URL.createObjectURL(blob);
  if (!refsInternal.update(id, { thumbSrc: url })) URL.revokeObjectURL(url);
}

/**
 * Syncs one ready image or link to the backend (no-op when not connected). Resumes from an
 * existing serverId; with `retry`, a failed Save is retried on the server first.
 * Never throws; outcomes land on the reference (`sync`, `error`).
 */
export async function syncRef(id: string, opts: { retry?: boolean } = {}): Promise<void> {
  const ref = refsInternal.getAny(id);
  if (!ref || ref.status !== 'ready' || (ref.kind !== 'image' && ref.kind !== 'link') || syncing.has(id)) return;
  if (status !== 'connected') {
    if (opts.retry) refsInternal.update(id, { sync: 'failed', error: "Not synced: the backend isn't connected." });
    return;
  }

  const myEpoch = epoch;
  syncing.add(id);
  refsInternal.update(id, {
    sync: 'syncing',
    error: ref.error?.startsWith('Not synced') ? undefined : ref.error,
  });
  const stillMine = () => epoch === myEpoch;
  try {
    let serverId = ref.serverId;
    let save: Save;
    if (!serverId) {
      if (ref.kind === 'image') {
        const blob = await blobStore.get(id, 'orig');
        if (!blob) throw new ApiClientError('missing_file', 'the original file is missing.', 0);
        const ext = EXT[blob.type] ?? 'bin';
        save = await uploadImage(new File([blob], `${ref.title || 'image'}.${ext}`, { type: blob.type }), ref.title, id);
      } else {
        if (!ref.url) throw new ApiClientError('bad_request', 'the link has no address.', 0);
        save = await saveLink(ref.url, undefined, id);
      }
      serverId = save.id;
      if (!stillMine()) return;
      if (!refsInternal.getAny(id)) {
        // Removed while uploading: don't leave an orphan on the server.
        deleteSave(save.id).catch(() => {});
        return;
      }
      refsInternal.update(id, { serverId });
    } else {
      save = await getSave(serverId);
      if (opts.retry && save.status === 'failed') save = await retrySave(serverId);
    }

    const final = await pollSave(save, serverId, myEpoch);
    if (!stillMine() || !refsInternal.getAny(id)) return;
    if (!final) {
      refsInternal.update(id, { sync: 'failed', error: 'Not synced: the backend is still working on it. Retry to check again.' });
      return;
    }
    if (final.status === 'failed') {
      refsInternal.update(id, { sync: 'failed', error: `Not synced: ${final.error || "the backend couldn't process it."}` });
      return;
    }

    if (ref.kind === 'link') {
      const patch: { title?: string; body?: string } = {};
      if (final.title.trim()) patch.title = final.title.trim();
      if (final.description?.trim()) patch.body = final.description.trim();
      refsInternal.update(id, patch);
      try {
        await fetchThumbnail(id, final);
      } catch {
        /* a missing preview must not fail the sync */
      }
      if (!stillMine()) return;
    }
    refsInternal.update(id, { sync: 'synced' });
  } catch (e) {
    if (stillMine()) refsInternal.update(id, { sync: 'failed', error: failMessage(e) });
  } finally {
    if (stillMine()) syncing.delete(id);
  }
}

/** Test helper: forget in-flight syncs and go back to a given status. */
export function _resetBackendForTests(next: BackendStatus = 'off'): void {
  epoch++;
  checkId++;
  syncing.clear();
  deleting.clear();
  status = next;
  for (const l of [...listeners]) l();
}

if (status === 'checking') setTimeout(() => void checkConnection(), 0);

// Capture changes from the extension while the application remains open.
if (typeof window !== 'undefined') window.setInterval(() => { if (status === 'connected') void refreshServerSaves(); }, 5000);
