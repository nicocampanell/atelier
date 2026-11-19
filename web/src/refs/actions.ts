// Add / update / retry / remove flows for user-added references.

import { deleteSave } from '../api/client';
import type { Reference } from '../types';
import type { AddResult } from './contracts';
import { cancelServerDeleting, markServerDeleting, syncRef } from './backend';
import { blobStore } from './idb';
import { blockSize, processImage, validateImageFile } from './image';
import { LINK_SIZE, newUserId, refsInternal, refsStore, USER_ID_PREFIX } from './store';

export { validateImageFile };

const PLACEHOLDER_COLOR = '#e9e6e0';
const NOTE_COLOR = '#fffdf6';
const SESSION_ONLY = 'Stored for this session only';
const OUT_OF_BLOB = "The original isn't available any more. Upload it again.";

export function isUserRefId(id: string): boolean {
  return id.startsWith(USER_ID_PREFIX);
}

const stripExtension = (name: string) => name.replace(/\.[^./\\]+$/, '') || name;

/** Image ids with local processing in flight. */
const processing = new Set<string>();

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

export function addImageFile(file: File): AddResult {
  const valid = validateImageFile(file);
  if (!valid.ok) return valid;
  const ref: Reference = {
    id: newUserId(),
    kind: 'image',
    title: stripExtension(file.name) || 'Untitled image',
    source: 'Upload',
    tags: ['added'],
    color: PLACEHOLDER_COLOR,
    w: 240,
    h: 180,
    status: 'saving',
    sync: 'local',
    userAdded: true,
  };
  refsInternal.add(ref);
  void runImageJob(ref.id, file, true);
  return { ok: true, ref };
}

/**
 * Decodes, resizes and stores an image. `raw` is the user's file the first time, or the stored
 * original when retrying.
 */
async function runImageJob(id: string, raw: Blob, storeRaw: boolean): Promise<void> {
  if (processing.has(id)) return;
  processing.add(id);
  const gone = () => !refsInternal.getAny(id);
  try {
    if (storeRaw) {
      // Keep the untouched file so Retry works even if the tab closes mid-processing.
      await blobStore.put(id, 'orig', raw);
      if (gone()) {
        void blobStore.delete(id);
        return;
      }
      refsInternal.setHasBlob(id, true);
    }
    const p = await processImage(raw);
    if (gone()) {
      void blobStore.delete(id);
      return;
    }

    const [keptOrig, keptThumb] = await Promise.all([
      blobStore.put(id, 'orig', p.original),
      blobStore.put(id, 'thumb', p.thumb),
    ]);
    if (gone()) {
      void blobStore.delete(id);
      return;
    }
    refsInternal.setHasBlob(id, true);

    const size = blockSize(p.width, p.height);
    const src = URL.createObjectURL(p.original);
    const thumbSrc = URL.createObjectURL(p.thumb);
    const patched = refsInternal.update(id, {
      w: size.w,
      h: size.h,
      color: p.color,
      src,
      thumbSrc,
      status: 'ready',
      error: keptOrig && keptThumb ? undefined : SESSION_ONLY,
    });
    if (!patched) {
      URL.revokeObjectURL(src);
      URL.revokeObjectURL(thumbSrc);
      void blobStore.delete(id);
      return;
    }
  } catch {
    refsInternal.update(id, {
      status: 'failed',
      error: "Couldn't read this image. It may be damaged or not supported by this browser.",
    });
    return;
  } finally {
    processing.delete(id);
  }
  void syncRef(id);
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

function normalizeUrl(input: string): URL | null {
  const text = input.trim();
  if (!text || /\s/.test(text)) return null;
  if (!text.includes('://') && /^(javascript|data|vbscript|file|blob|mailto|tel):/i.test(text)) return null;
  const withScheme = text.includes('://') ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname;
  if (!host.includes('.') && host !== 'localhost' && !host.startsWith('[')) return null;
  return url;
}

export function addLink(input: string): AddResult {
  const url = normalizeUrl(input);
  if (!url) return { ok: false, error: input.trim() ? "That doesn't look like a web address." : 'Paste a link first.' };
  const host = url.hostname.replace(/^www\./, '');
  const ref: Reference = {
    id: newUserId(),
    kind: 'link',
    title: host,
    source: host,
    tags: ['added'],
    color: PLACEHOLDER_COLOR,
    body: url.href,
    url: url.href,
    ...LINK_SIZE,
    status: 'saving',
    sync: 'local',
    userAdded: true,
  };
  refsInternal.add(ref);
  setTimeout(() => finishLink(ref.id), 0);
  return { ok: true, ref };
}

function finishLink(id: string): void {
  if (!refsInternal.update(id, { status: 'ready', error: undefined })) return;
  void syncRef(id);
}

/* ------------------------------------------------------------------ */
/* Notes                                                               */
/* ------------------------------------------------------------------ */

const noteHeight = (body: string) => Math.max(130, Math.min(260, Math.round(110 + body.length * 0.5)));
const noteTitle = (body: string) => {
  const line = body.trim().split('\n')[0].trim();
  return line.length > 40 ? `${line.slice(0, 39)}…` : line || 'Note';
};

export function addNote(body: string, title?: string): AddResult {
  const text = body.trim();
  // An empty body is fine when a title is given: the UI creates "Untitled note" and opens the editor.
  if (!text && !title?.trim()) return { ok: false, error: 'Write something first.' };
  const ref: Reference = {
    id: newUserId(),
    kind: 'note',
    title: title?.trim() || noteTitle(text),
    source: 'Note',
    tags: ['added'],
    color: NOTE_COLOR,
    body: text,
    w: 240,
    h: noteHeight(text),
    status: 'ready',
    userAdded: true,
  };
  refsInternal.add(ref);
  return { ok: true, ref };
}

export function updateNote(id: string, patch: { title?: string; body?: string }): void {
  const ref = refsInternal.getAny(id);
  if (!ref || ref.kind !== 'note') return;
  const next: Partial<Reference> = {};
  if (patch.body !== undefined) {
    next.body = patch.body;
    next.h = noteHeight(patch.body.trim());
  }
  if (patch.title !== undefined) {
    next.title = patch.title.trim() || noteTitle(patch.body ?? ref.body ?? '');
  }
  refsInternal.update(id, next);
}

/* ------------------------------------------------------------------ */
/* Retry                                                               */
/* ------------------------------------------------------------------ */

export function retry(id: string): void {
  const ref = refsStore.get(id);
  if (!ref || !ref.userAdded) return;
  if (ref.status === 'failed' && ref.serverId) {
    refsInternal.update(id, { status: 'ready', sync: 'failed' });
    void syncRef(id, { retry: true });
    return;
  }
  if (ref.status === 'failed') {
    if (ref.kind === 'image') {
      if (processing.has(id)) return;
      void (async () => {
        const blob = await blobStore.get(id, 'orig');
        if (!blob) {
          refsInternal.update(id, { error: OUT_OF_BLOB });
          return;
        }
        if (!refsInternal.update(id, { status: 'saving', error: undefined })) return;
        await runImageJob(id, blob, false);
      })();
    } else if (ref.kind === 'link') {
      refsInternal.update(id, { status: 'saving', error: undefined });
      setTimeout(() => finishLink(id), 0);
    }
    return;
  }
  if (ref.status === 'ready' && ref.sync === 'failed') void syncRef(id, { retry: true });
}

/* ------------------------------------------------------------------ */
/* Remove                                                              */
/* ------------------------------------------------------------------ */

export function removeRef(id: string): { undo(): void; commit(): void } | null {
  if (!isUserRefId(id) || !refsStore.get(id)) return null;
  const ref = refsInternal.remove(id);
  if (!ref) return null;
  let state: 'pending' | 'done' = 'pending';
  return {
    undo() {
      if (state !== 'pending') return;
      state = 'done';
      refsInternal.restore(id);
    },
    commit() {
      if (state !== 'pending') return;
      state = 'done';
      if (ref.serverId) markServerDeleting(ref.serverId);
      const dropped = refsInternal.purge(id) ?? ref;
      void blobStore.delete(id);
      if (dropped.serverId) deleteSave(dropped.serverId).catch(() => cancelServerDeleting(dropped.serverId!));
    },
  };
}
