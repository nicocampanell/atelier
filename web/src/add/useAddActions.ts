import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board } from '../state/board';
import { MAIN_ID, type BoardsStore } from '../state/contracts';
import { markMainSeen } from '../state/boards';
import type { Reference } from '../types';
import type { CameraApi } from '../canvas/useCamera';
import { useReferences } from '../refs/store';
import { addImageFile, addLink, addNote, removeRef, validateImageFile } from '../refs/actions';
import type { ToastsApi } from './UndoToast';

const STACK_STEP = 24;
const ROW_GAP = 24;
const ADD_MS = 5000;
const DELETE_MS = 6000;

export type Point = { x: number; y: number };

/** Where a new reference goes. */
export type Target =
  | { type: 'board'; at: Point | null } // onto the live board: at the point, or the viewport centre
  | { type: 'tile'; boardId: string } // onto one overview board
  | { type: 'library' }; // into the library only

interface Ctx {
  store: BoardsStore;
  /** The board blocks are placed on (the search view's board while one is showing). */
  live: Board;
  camera: CameraApi;
  /** A board is on screen and takes input. */
  inBoard: boolean;
  toasts: ToastsApi;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function summary(refs: Reference[]): string {
  if (refs.length === 1) return `“${refs[0].title}”`;
  const kind = refs.every((r) => r.kind === refs[0].kind) ? refs[0].kind : null;
  return kind ? plural(refs.length, kind, kind === 'image' ? 'images' : `${kind}s`) : `${refs.length} references`;
}

/** Everything that adds, places and deletes user references, with its toasts. */
export function useAddActions(ctx: Ctx) {
  const cur = useRef(ctx);
  useEffect(() => {
    cur.current = ctx;
  });

  /** Block being edited inline (a note just created or double-clicked). */
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const pendingEdit = useRef<string | null>(null);
  const provisional = useRef(new Set<string>());
  const { byId } = useReferences();
  const byIdRef = useRef(byId);
  useEffect(() => {
    byIdRef.current = byId;
  });

  // A new note opens its editor as soon as its block exists; a decoded image takes its real size.
  const { live } = ctx;
  useEffect(() => {
    if (pendingEdit.current) {
      const item = [...live.items].reverse().find((i) => i.refId === pendingEdit.current);
      if (item) {
        setEditingItemId(item.id);
        pendingEdit.current = null;
      }
    }
    if (!provisional.current.size) return;
    let changed = false;
    const next = live.items.map((i) => {
      const r = provisional.current.has(i.refId) ? byId[i.refId] : undefined;
      if (!r || r.status === 'saving' || (Math.abs(r.w - i.w) < 0.5 && Math.abs(r.h - i.h) < 0.5)) return i;
      changed = true;
      return { ...i, x: i.x + (i.w - r.w) / 2, y: i.y + (i.h - r.h) / 2, w: r.w, h: r.h };
    });
    for (const id of [...provisional.current]) if (byId[id]?.status !== 'saving') provisional.current.delete(id);
    if (changed) live.replace(next);
  }, [live, byId]);

  const place = useCallback((refs: Reference[], at: Point | null) => {
    const { live, camera } = cur.current;
    const total = refs.reduce((s, r) => s + r.w, 0) + ROW_GAP * (refs.length - 1);
    let { x, y } = at ?? camera.center();
    if (!at) {
      // Same diagonal stepping as the search "add": never land exactly on an existing block.
      const taken = (px: number, py: number) => live.items.some((i) => Math.hypot(i.x + i.w / 2 - px, i.y + i.h / 2 - py) < 12);
      while (taken(x, y)) {
        x += STACK_STEP;
        y += STACK_STEP;
      }
    }
    let left = x - total / 2;
    for (const r of refs) {
      live.add(r.id, left + r.w / 2, y);
      left += r.w + ROW_GAP;
      if (r.status === 'saving') provisional.current.add(r.id);
    }
  }, []);

  const undoAdd = useCallback((refs: Reference[]) => {
    const { store, live } = cur.current;
    for (const r of refs) {
      removeRef(r.id)?.commit();
      store.removeItemsOfRef(r.id);
      const stray = live.items.filter((i) => i.refId === r.id).map((i) => i.id);
      if (stray.length) live.remove(stray);
    }
  }, []);

  /** Put freshly created references where the target says, and announce them with an Undo. */
  const land = useCallback(
    (refs: Reference[], target: Target) => {
      if (!refs.length) return;
      const { store, toasts } = cur.current;
      const boardName = (id: string) => store.boards.find((b) => b.id === id)?.name || 'Untitled board';
      let text = `Added ${summary(refs)}`;
      const actions = [{ label: 'Undo', run: () => undoAdd(refs) }];

      if (target.type === 'board') {
        place(refs, target.at);
      } else if (target.type === 'tile') {
        for (const r of refs) store.addRef(target.boardId, r.id);
        text += ` to ${target.boardId === MAIN_ID ? 'the main area' : boardName(target.boardId)}`;
      } else {
        text += ' to library';
        markMainSeen(refs.map((r) => r.id)); // library-only: keep the auto-place out of it
        const last = store.lastOpenedId ?? store.boards[0]?.id;
        if (last && store.boards.some((b) => b.id === last)) {
          actions.push({
            label: `Add to ${boardName(last)}`,
            run: () => {
              for (const r of refs) store.addRef(last, r.id);
            },
          });
        }
      }
      toasts.push({ text, actions, ms: ADD_MS });
    },
    [place, undoAdd],
  );

  /** `at` (a right-clicked world point) pins the add to that spot on the live board. */
  const defaultTarget = useCallback(
    (at?: Point): Target => (at ? { type: 'board', at } : cur.current.inBoard ? { type: 'board', at: null } : { type: 'tile', boardId: MAIN_ID }),
    [],
  );

  const addFiles = useCallback(
    (files: File[], target?: Target) => {
      const refs: Reference[] = [];
      const rejected: string[] = [];
      for (const f of files) {
        const v = validateImageFile(f);
        if (!v.ok) {
          rejected.push(v.error);
          continue;
        }
        const r = addImageFile(f);
        if (r.ok) refs.push(r.ref);
        else rejected.push(r.error);
      }
      if (rejected.length) {
        cur.current.toasts.push({
          kind: 'error',
          text: rejected.length === 1 ? rejected[0] : `${rejected.length} files weren’t added`,
          lines: rejected.length === 1 ? undefined : rejected,
          ms: 8000,
        });
      }
      land(refs, target ?? defaultTarget());
    },
    [land, defaultTarget],
  );

  /** Returns an error message for the dialog to show, or null when added. */
  const addLinkUrl = useCallback(
    (url: string, at?: Point): string | null => {
      const r = addLink(url);
      if (!r.ok) return r.error;
      land([r.ref], defaultTarget(at));
      return null;
    },
    [land, defaultTarget],
  );

  const addPastedLink = useCallback(
    (url: string) => {
      const r = addLink(url);
      if (r.ok) land([r.ref], defaultTarget());
      else cur.current.toasts.push({ kind: 'error', text: r.error, ms: 6000 });
    },
    [land, defaultTarget],
  );

  const newNote = useCallback((at?: Point) => {
    const r = addNote('', 'Untitled note');
    if (!r.ok) {
      cur.current.toasts.push({ kind: 'error', text: r.error, ms: 6000 });
      return;
    }
    const target = defaultTarget(at);
    if (target.type === 'board') pendingEdit.current = r.ref.id;
    land([r.ref], target);
  }, [land, defaultTarget]);

  /** Delete references from the library (and every board), with a 6 s Undo before it is final. */
  const deleteRefs = useCallback((ids: string[]) => {
    const { store, live, toasts } = cur.current;
    const done: { title: string; handle: NonNullable<ReturnType<typeof removeRef>>; placed: ReturnType<BoardsStore['removeItemsOfRef']> }[] = [];
    for (const id of ids) {
      const title = byIdRef.current[id]?.title ?? 'reference';
      const handle = removeRef(id);
      if (!handle) continue;
      done.push({ title, handle, placed: store.removeItemsOfRef(id) });
      const stray = live.items.filter((i) => i.refId === id).map((i) => i.id);
      if (stray.length) live.remove(stray);
    }
    if (!done.length) return;
    toasts.push({
      text: done.length === 1 ? `Deleted “${done[0].title}”` : `Deleted ${done.length} references`,
      ms: DELETE_MS,
      actions: [
        {
          label: 'Undo',
          run: () => {
            for (const d of done) {
              d.handle.undo();
              cur.current.store.restoreItems(d.placed);
            }
          },
        },
      ],
      onExpire: () => done.forEach((d) => d.handle.commit()),
    });
  }, []);

  return {
    addFiles,
    addLinkUrl,
    addPastedLink,
    newNote,
    deleteRefs,
    editingItemId,
    stopEditing: useCallback(() => setEditingItemId(null), []),
    editItem: setEditingItemId,
  };
}
