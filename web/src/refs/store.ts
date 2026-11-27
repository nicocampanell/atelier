// Reference store: saved references and lookup for old sample board cards. Module-level singleton,
// reactive through useSyncExternalStore. Metadata persists per record to IndexedDB (localStorage
// when IndexedDB is unavailable); image blobs live there too (see idb.ts). Startup creates object
// URLs for thumbnails only; originals load on demand through ensureOriginal().

import { useSyncExternalStore } from 'react';
import { REFERENCES } from '../data/references';
import type { Reference, ReferenceKind, ReferenceStatus, SyncState } from '../types';
import type { RefsSnapshot, RefsStore } from './contracts';
import { blobStore } from './idb';

export const REFS_STORAGE_KEY = 'atelier.refs.v1';
export const USER_ID_PREFIX = 'u-';
export const INTERRUPTED_ERROR = 'Interrupted before it finished saving.';
export const LOST_BLOB_ERROR = "This image wasn't kept after the session ended. Upload it again.";
/** A link card before its preview image loads; one with a preview is refit to the image. */
export const LINK_SIZE = { w: 260, h: 96 } as const;

/** Height of a link card at LINK_SIZE.w that shows its preview image uncropped (within limits). */
export const linkImageHeight = (naturalW: number, naturalH: number) =>
  Math.max(140, Math.min(420, Math.round((LINK_SIZE.w * naturalH) / naturalW)));
const PERSIST_DEBOUNCE_MS = 250;
const DEFAULT_COLOR = '#e9e6e0';

const SEED_IDS = new Set(REFERENCES.map((r) => r.id));

export function newUserId(): string {
  let rand: string;
  try {
    rand = crypto.randomUUID();
  } catch {
    rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
  return USER_ID_PREFIX + rand;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** User references, newest first, including ones hidden while a removal can still be undone. */
let users: Reference[] = [];
const hidden = new Set<string>();
/** Ids that have blobs in IndexedDB (or in the in-memory fallback). Persisted as `hasBlob`. */
const blobIds = new Set<string>();
const listeners = new Set<() => void>();
let persistTimer: ReturnType<typeof setTimeout> | null = null;
/** Metadata lives in IndexedDB (true) or, when it is unavailable, in one localStorage JSON (false). */
let idbMeta = false;
/** False until hydrate() has loaded the saved references; nothing is persisted before that. */
let ready = false;
/** Ids changed / dropped since the last IndexedDB write. */
const dirty = new Set<string>();
const gone = new Set<string>();
/** Newer references have a higher seq; `seqs` doubles as the set of known user ids. */
const seqs = new Map<string, number>();
let maxSeq = 0;

function build(): RefsSnapshot {
  const list = users.filter((u) => !hidden.has(u.id));
  const byId: Record<string, Reference> = Object.create(null);
  for (const r of REFERENCES) byId[r.id] = r;
  for (const r of list) byId[r.id] = r;
  return { list, byId };
}

let snapshot: RefsSnapshot = build();

function commit(visible: boolean): void {
  schedulePersist();
  if (!visible) return;
  snapshot = build();
  for (const l of [...listeners]) l();
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const isBlobUrl = (v: unknown) => typeof v === 'string' && v.startsWith('blob:');

function toRecord(r: Reference): { id: string } {
  const copy: Record<string, unknown> = { ...r };
  if (isBlobUrl(copy.src)) delete copy.src;
  if (isBlobUrl(copy.thumbSrc)) delete copy.thumbSrc;
  copy.hasBlob = blobIds.has(r.id);
  copy.seq = seqs.get(r.id);
  return copy as { id: string };
}

const serialize = () => JSON.stringify({ version: 1, refs: users.map(toRecord) });

/** Writes pending metadata now: only the changed records to IndexedDB, or everything to localStorage. */
function persistNow(): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  if (!ready) return Promise.resolve();
  if (!idbMeta) {
    dirty.clear();
    gone.clear();
    try {
      storage()?.setItem(REFS_STORAGE_KEY, serialize());
    } catch {
      /* storage unavailable or full */
    }
    return Promise.resolve();
  }
  const ids = [...dirty];
  const deletes = [...gone];
  const byId = new Map(users.map((u) => [u.id, u]));
  const puts = ids.flatMap((id) => (byId.has(id) ? [toRecord(byId.get(id)!)] : []));
  dirty.clear();
  gone.clear();
  if (!puts.length && !deletes.length) return Promise.resolve();
  // ponytail: a failed write is retried with the next change, not on a timer.
  return blobStore.metaWrite(puts, deletes).then((ok) => {
    if (ok) return;
    for (const id of ids) dirty.add(id);
    for (const id of deletes) gone.add(id);
  });
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
}

const KINDS: readonly ReferenceKind[] = ['image', 'note', 'link'];
const STATUSES: readonly ReferenceStatus[] = ['saving', 'ready', 'failed'];
const SYNCS: readonly SyncState[] = ['local', 'syncing', 'synced', 'failed'];
const str = (v: unknown): v is string => typeof v === 'string';
const dim = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= 20000;

/** Validates one persisted entry. Returns null when it is unusable. */
export function parseStoredRef(v: unknown): { ref: Reference; hasBlob: boolean } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!str(o.id) || !o.id.startsWith(USER_ID_PREFIX) || o.id.length > 100 || SEED_IDS.has(o.id)) return null;
  if (!KINDS.includes(o.kind as ReferenceKind)) return null;
  if (!str(o.title) || !str(o.source) || !dim(o.w) || !dim(o.h)) return null;
  const hasBlob = o.hasBlob === true;
  const kind = o.kind as ReferenceKind;

  const ref: Reference = {
    id: o.id,
    kind,
    title: o.title,
    source: o.source,
    tags: Array.isArray(o.tags) ? o.tags.filter(str) : [],
    color: str(o.color) && /^#[0-9a-f]{3,8}$/i.test(o.color) ? o.color : DEFAULT_COLOR,
    w: o.w,
    h: o.h,
    userAdded: true,
    status: STATUSES.includes(o.status as ReferenceStatus) ? (o.status as ReferenceStatus) : 'ready',
  };
  if (str(o.body)) ref.body = o.body;
  if (str(o.url)) ref.url = o.url;
  if (str(o.serverId)) ref.serverId = o.serverId;
  if (str(o.error)) ref.error = o.error;
  if (SYNCS.includes(o.sync as SyncState)) ref.sync = o.sync as SyncState;
  if (str(o.src) && !isBlobUrl(o.src)) ref.src = o.src;
  if (str(o.thumbSrc) && !isBlobUrl(o.thumbSrc)) ref.thumbSrc = o.thumbSrc;

  if (ref.status === 'saving') {
    ref.status = 'failed';
    ref.error = kind === 'image' && !hasBlob ? `${INTERRUPTED_ERROR} Upload it again.` : INTERRUPTED_ERROR;
  } else if (kind === 'image' && ref.status === 'ready' && !hasBlob && !ref.src && !ref.serverId) {
    ref.status = 'failed';
    ref.error = LOST_BLOB_ERROR;
  }
  if (ref.sync === 'syncing') {
    ref.sync = 'failed';
    ref.error ??= 'Not synced: interrupted before it finished.';
  }
  return { ref, hasBlob };
}

/** Saved localStorage entries (the pre-IndexedDB format, or the fallback), or null. */
function legacyEntries(): unknown[] | null {
  try {
    const text = storage()?.getItem(REFS_STORAGE_KEY);
    const raw: unknown = text ? JSON.parse(text) : null;
    const entries = raw && typeof raw === 'object' ? (raw as { refs?: unknown }).refs : null;
    return Array.isArray(entries) && entries.length ? entries : null;
  } catch {
    return null;
  }
}

/** Validates entries (newest first) into the store. `bySeq` keeps their saved seq, else seq follows position. */
function adopt(entries: unknown[], bySeq: boolean): void {
  const seen = new Set<string>();
  const next: Reference[] = [];
  entries.forEach((e, i) => {
    const parsed = parseStoredRef(e);
    if (!parsed || seen.has(parsed.ref.id)) return;
    seen.add(parsed.ref.id);
    if (parsed.hasBlob) blobIds.add(parsed.ref.id);
    const saved = (e as { seq?: unknown }).seq;
    const seq = bySeq && typeof saved === 'number' && Number.isFinite(saved) ? saved : entries.length - i;
    seqs.set(parsed.ref.id, seq);
    maxSeq = Math.max(maxSeq, seq);
    next.push(parsed.ref);
  });
  users = next;
  snapshot = build();
}

const rowSeq = (r: unknown) => (r && typeof (r as { seq?: unknown }).seq === 'number' ? (r as { seq: number }).seq : 0);

/**
 * Loads saved metadata. IndexedDB records win; an empty IndexedDB is seeded once from localStorage,
 * and that key is removed only after the IndexedDB write succeeded. Without IndexedDB (or when the
 * seeding write fails) metadata stays in localStorage and nothing is removed.
 */
async function hydrate(): Promise<void> {
  const rows = await blobStore.metaAll();
  const legacy = rows?.length ? null : legacyEntries();
  if (rows?.length) {
    adopt([...rows].sort((a, b) => rowSeq(b) - rowSeq(a)), true);
    idbMeta = true;
  } else if (legacy) {
    adopt(legacy, false);
    idbMeta = !!rows && (await blobStore.metaWrite(users.map(toRecord), []));
    if (idbMeta) {
      try {
        storage()?.removeItem(REFS_STORAGE_KEY);
      } catch {
        /* a leftover key is ignored from now on */
      }
    }
  } else {
    idbMeta = !!rows;
  }
}

function revokeUrl(url: string | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* ignore */
  }
}

/** Reads stored thumbnails for ready references and patches their object URLs in as ONE store update. */
async function hydrateBlobs(): Promise<void> {
  const targets = users.filter((r) => blobIds.has(r.id) && r.status === 'ready');
  // Originals are not read here (ensureOriginal does that on demand); only an image without a thumb falls back to its original.
  const found = new Map(
    await Promise.all(
      targets.map(async (r) => {
        const blob = (await blobStore.get(r.id, 'thumb')) ?? (r.kind === 'image' ? await blobStore.get(r.id, 'orig') : undefined);
        return [r.id, blob] as const;
      }),
    ),
  );
  if (!found.size) return;
  users = users.map((u) => {
    if (!found.has(u.id)) return u;
    const blob = found.get(u.id);
    if (blob) {
      revokeUrl(u.thumbSrc);
      return { ...u, thumbSrc: URL.createObjectURL(blob) };
    }
    if (u.kind !== 'image') return u;
    dirty.add(u.id);
    return { ...u, status: 'failed', error: LOST_BLOB_ERROR };
  });
  commit(true);
}

const originals = new Map<string, Promise<string | undefined>>();

/**
 * The full-size image URL of a reference, reading the original blob from IndexedDB once and
 * patching it into `ref.src` (subscribers are notified). Until then `src` is undefined and
 * `thumbSrc` is shown. Resolves undefined when there is no original (notes, links, server
 * thumbnails, unknown ids). Seeds and already-loaded references resolve immediately.
 */
export function ensureOriginal(id: string): Promise<string | undefined> {
  const ref = refsInternal.getAny(id) ?? refsStore.get(id);
  if (!ref || ref.src || !ref.userAdded || ref.kind !== 'image' || !blobIds.has(id)) return Promise.resolve(ref?.src);
  let p = originals.get(id);
  if (!p) {
    p = blobStore
      .get(id, 'orig')
      .then((blob) => {
        if (!blob) return undefined;
        const url = URL.createObjectURL(blob);
        if (refsInternal.update(id, { src: url })) return url;
        revokeUrl(url);
        return undefined;
      })
      .finally(() => originals.delete(id));
    originals.set(id, p);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Internal mutators (actions.ts and backend.ts only)                  */
/* ------------------------------------------------------------------ */

export type RefPatch = Partial<Reference>;

export const refsInternal = {
  /** Adds a new user reference at the front. Refuses ids that collide or lack the "u-" prefix. */
  add(ref: Reference): boolean {
    if (!ref.id.startsWith(USER_ID_PREFIX) || SEED_IDS.has(ref.id) || users.some((u) => u.id === ref.id)) return false;
    users = [{ ...ref, userAdded: true }, ...users];
    seqs.set(ref.id, ++maxSeq);
    dirty.add(ref.id);
    gone.delete(ref.id);
    commit(true);
    return true;
  },

  /**
   * Patches a user reference (a key set to undefined is removed). Works on hidden references
   * without making them visible. Returns false when the id is unknown. Replaced object URLs are revoked.
   */
  update(id: string, patch: RefPatch): boolean {
    const idx = users.findIndex((u) => u.id === id);
    if (idx < 0) return false;
    const old = users[idx];
    const next: Record<string, unknown> = { ...old };
    let changed = false;
    let persisted = false; // object URLs are never persisted
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'userAdded') continue;
      if (v === undefined ? k in next : next[k] !== v) {
        const urlOnly = (k === 'src' || k === 'thumbSrc') && [v, next[k]].every((u) => u === undefined || isBlobUrl(u));
        persisted ||= !urlOnly;
        changed = true;
        if (v === undefined) delete next[k];
        else next[k] = v;
      }
    }
    if (!changed) return true;
    if (persisted) dirty.add(id);
    const updated = next as unknown as Reference;
    if (updated.src !== old.src) revokeUrl(old.src);
    if (updated.thumbSrc !== old.thumbSrc) revokeUrl(old.thumbSrc);
    users = users.map((u, i) => (i === idx ? updated : u));
    commit(!hidden.has(id));
    return true;
  },

  /** Hides a reference (pending removal). Returns it, or undefined if unknown or already hidden. */
  remove(id: string): Reference | undefined {
    const ref = users.find((u) => u.id === id);
    if (!ref || hidden.has(id)) return undefined;
    hidden.add(id);
    commit(true);
    return ref;
  },

  /** Undoes remove(). */
  restore(id: string): boolean {
    if (!hidden.delete(id)) return false;
    commit(true);
    return true;
  },

  /** Permanently drops a user reference (hidden or not) and revokes its object URLs. */
  purge(id: string): Reference | undefined {
    const ref = users.find((u) => u.id === id);
    if (!ref) return undefined;
    const wasHidden = hidden.delete(id);
    users = users.filter((u) => u.id !== id);
    blobIds.delete(id);
    seqs.delete(id);
    dirty.delete(id);
    gone.add(id);
    revokeUrl(ref.src);
    revokeUrl(ref.thumbSrc);
    commit(!wasHidden);
    return ref;
  },

  /** Include hidden references so a refresh cannot resurrect a pending deletion. */
  allUsers: () => [...users],
  /** A user reference including hidden ones. */
  getAny(id: string): Reference | undefined {
    return users.find((u) => u.id === id);
  },
  isHidden: (id: string) => hidden.has(id),
  setHasBlob(id: string, has: boolean): void {
    if (has) blobIds.add(id);
    else blobIds.delete(id);
    if (seqs.has(id)) dirty.add(id);
    schedulePersist();
  },
  hasBlob: (id: string) => blobIds.has(id),
};

/* ------------------------------------------------------------------ */
/* Public store                                                        */
/* ------------------------------------------------------------------ */

export const refsStore: RefsStore = {
  getSnapshot: () => snapshot,
  subscribe(listener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: (id) => snapshot.byId[id],
  has: (id) => id in snapshot.byId,
};

export function useReferences(): RefsSnapshot {
  return useSyncExternalStore(refsStore.subscribe, refsStore.getSnapshot, refsStore.getSnapshot);
}

export function useReference(id: string): Reference | undefined {
  return useSyncExternalStore(
    refsStore.subscribe,
    () => snapshot.byId[id],
    () => snapshot.byId[id],
  );
}

/* ------------------------------------------------------------------ */
/* Test helpers                                                        */
/* ------------------------------------------------------------------ */

/** Writes pending metadata immediately. */
export function _flushPersistForTests(): Promise<void> {
  return persistNow();
}

/** Clears all user references. With `hydrate`, re-reads saved metadata first and waits for thumbnail URLs. */
export async function _resetForTests(opts: { hydrate?: boolean } = {}): Promise<void> {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = null;
  users = [];
  hidden.clear();
  blobIds.clear();
  dirty.clear();
  gone.clear();
  seqs.clear();
  originals.clear();
  maxSeq = 0;
  idbMeta = false;
  ready = true;
  snapshot = build();
  if (opts.hydrate) {
    await hydrate();
    await hydrateBlobs();
  }
  for (const l of [...listeners]) l();
}

/** Resolves once saved references are loaded (thumbnail URLs follow shortly after). Never rejects. */
export const refsReady: Promise<void> = hydrate()
  .catch(() => {})
  .then(() => {
    ready = true;
    void hydrateBlobs();
  });

// IndexedDB writes are async: flush the debounce window when the page goes away.
if (typeof addEventListener === 'function') addEventListener('pagehide', () => void persistNow());
