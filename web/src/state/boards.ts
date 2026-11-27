import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { BoardItem, Camera, Reference } from '../types';
import { REFERENCES, SEED_LAYOUT } from '../data/references';
import { LINK_SIZE, refsStore } from '../refs/store';
import { useBackendStatus, refreshServerSaves } from '../refs/backend';
import { ApiClientError, createProject, listProjects, getProjectBoard, putProjectBoard, renameProject, deleteProject, type ServerBoard } from '../api/client';
import { reducer as boardReducer, uid, type Board, type BoardAction } from './board';
import { BOARD_TILE_H, BOARD_TILE_W, MAIN_ID, type BoardMeta, type BoardsStore, type PlacedItem } from './contracts';

export const BOARDS_STORAGE_KEY = 'atelier.boards.v1';
export const LEGACY_STORAGE_KEY = 'atelier.board.v1';

const SAVE_DEBOUNCE_MS = 250;
const TILE_GAP = 64;
const TILE_COLS = 3;
const CARD_GAP = 60;
const ADD_GAP = 60;
const EMPTY: BoardItem[] = [];

/** Size of the card a child board shows as on its parent. */
export const SUBBOARD_SIZE = { w: 240, h: 200 } as const;

export interface BoardsState {
  boards: BoardMeta[];
  /** Also holds `items[MAIN_ID]` (the overview's own items), which has no BoardMeta. */
  items: Record<string, BoardItem[]>;
  lastOpenedId: string | null;
}

/* ------------------------------------------------------------------ *
 * Overview grid
 * ------------------------------------------------------------------ */

const rawSlot = (i: number) => ({
  x: (i % TILE_COLS) * (BOARD_TILE_W + TILE_GAP),
  y: Math.floor(i / TILE_COLS) * (BOARD_TILE_H + TILE_GAP),
});

/** Origin offset that centers the 4 seeded tiles on (0, 0). Slots are computed relative to it. */
const SEED_COUNT = 4;
const GRID_ORIGIN = (() => {
  const last = rawSlot(SEED_COUNT - 1);
  const w = Math.min(SEED_COUNT, TILE_COLS) * BOARD_TILE_W + (Math.min(SEED_COUNT, TILE_COLS) - 1) * TILE_GAP;
  const h = last.y + BOARD_TILE_H;
  return { x: Math.round(-w / 2), y: Math.round(-h / 2) };
})();

/** Top-left of overview grid slot `i` in world px. */
export function tileSlot(i: number): { x: number; y: number } {
  const s = rawSlot(i);
  return { x: GRID_ORIGIN.x + s.x, y: GRID_ORIGIN.y + s.y };
}

/** The first grid slot whose tile rectangle is not overlapped by an existing tile. */
export function nextTileSlot(boards: Pick<BoardMeta, 'x' | 'y' | 'parentId'>[]): { x: number; y: number } {
  for (let i = 0; ; i++) {
    const s = tileSlot(i);
    const hit = boards.some(
      (b) =>
        !b.parentId &&
        s.x < b.x + BOARD_TILE_W && s.x + BOARD_TILE_W > b.x && s.y < b.y + BOARD_TILE_H && s.y + BOARD_TILE_H > b.y,
    );
    if (!hit) return s;
  }
}

/** "Untitled board", "Untitled board 2", ... */
export function uniqueBoardName(boards: Pick<BoardMeta, 'name'>[], base = 'Untitled board'): string {
  const taken = new Set(boards.map((b) => b.name));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

/* ------------------------------------------------------------------ *
 * Seeds
 * ------------------------------------------------------------------ */

const toItem = (ref: Reference, x: number, y: number, z: number): BoardItem => ({
  id: uid(),
  refId: ref.id,
  x,
  y,
  w: ref.w,
  h: ref.h,
  z,
});

/** Shortest-column masonry (3 columns, native sizes, 60px between cards), centered on the origin. */
export function masonryLayout(refIds: string[], cols = 3): BoardItem[] {
  const refs = refIds.flatMap((id) => {
    const r = refsStore.get(id);
    return r ? [r] : [];
  });
  if (!refs.length) return [];
  const n = Math.min(cols, refs.length);
  const heights = new Array<number>(n).fill(0);
  const colOf: number[] = [];
  const yOf: number[] = [];
  refs.forEach((ref) => {
    let c = 0;
    for (let k = 1; k < n; k++) if (heights[k] < heights[c]) c = k;
    colOf.push(c);
    yOf.push(heights[c]);
    heights[c] += ref.h + CARD_GAP;
  });
  const widths = new Array<number>(n).fill(0);
  refs.forEach((ref, i) => (widths[colOf[i]] = Math.max(widths[colOf[i]], ref.w)));
  const colX: number[] = [];
  widths.reduce((acc, w, c) => ((colX[c] = acc), acc + w + CARD_GAP), 0);
  const totalW = colX[n - 1] + widths[n - 1];
  const totalH = Math.max(...heights) - CARD_GAP;
  return refs.map((ref, i) =>
    toItem(ref, Math.round(colX[colOf[i]] - totalW / 2), Math.round(yOf[i] - totalH / 2), i + 1),
  );
}

const SEED_DEFS: { name: string; items: () => BoardItem[] }[] = [
  {
    name: 'Moodboard',
    items: () =>
      SEED_LAYOUT.flatMap(({ refId, x, y }, i) => {
        const ref = refsStore.get(refId);
        return ref ? [toItem(ref, x, y, i + 1)] : [];
      }),
  },
  {
    name: 'Food',
    items: () => masonryLayout([...REFERENCES.filter((r) => r.id.startsWith('f-')).map((r) => r.id), 'n-food']),
  },
  {
    name: 'Interiors',
    items: () =>
      masonryLayout([
        'r-sofa',
        'r-living',
        'r-office',
        'r-bedroom',
        'r-interior-plants',
        'r-chair-corner',
        'n-light',
      ]),
  },
  {
    name: 'Color',
    items: () =>
      masonryLayout(['r-grad-1', 'r-grad-2', 'r-grad-3', 'r-paint', 'r-flower', 'r-headphones', 'n-palette']),
  },
];

const newMeta = (name: string, pos: { x: number; y: number }, now: number): BoardMeta => ({
  id: uid(),
  name,
  x: pos.x,
  y: pos.y,
  camera: null,
  createdAt: now,
  updatedAt: now,
});

/** The four starter boards. `legacyMoodboard`, when given, replaces the Moodboard's items. */
export function seedBoards(now = Date.now(), legacyMoodboard?: BoardItem[]): BoardsState {
  const boards: BoardMeta[] = [];
  const items: Record<string, BoardItem[]> = { [MAIN_ID]: [] };
  SEED_DEFS.forEach((def, i) => {
    const meta = newMeta(def.name, tileSlot(i), now);
    boards.push(meta);
    items[meta.id] = i === 0 && legacyMoodboard ? legacyMoodboard : def.items();
  });
  return { boards, items, lastOpenedId: null };
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isItemShape(v: unknown): v is BoardItem {
  if (!v || typeof v !== 'object') return false;
  const i = v as Record<string, unknown>;
  return typeof i.id === 'string' && typeof i.refId === 'string' && ['x', 'y', 'w', 'h', 'z'].every((k) => isNum(i[k]));
}

export const isBoardItem = (v: unknown): v is BoardItem => isItemShape(v) && refsStore.has(v.refId);

const isBoardCard = (v: unknown, boardIds: ReadonlySet<string>): v is BoardItem =>
  isItemShape(v) && v.refId === '' && typeof v.boardId === 'string' && boardIds.has(v.boardId);

function isCamera(v: unknown): v is Camera {
  if (!v || typeof v !== 'object') return false;
  const c = v as Record<string, unknown>;
  return isNum(c.x) && isNum(c.y) && isNum(c.zoom) && c.zoom > 0;
}

function isBoardMeta(v: unknown): v is BoardMeta {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.id === 'string' &&
    b.id.length > 0 &&
    typeof b.name === 'string' &&
    (b.parentId === undefined || typeof b.parentId === 'string') &&
    isNum(b.x) &&
    isNum(b.y) &&
    (b.camera === null || isCamera(b.camera)) &&
    isNum(b.createdAt) &&
    isNum(b.updatedAt)
  );
}

/** Returns null when the payload is structurally unusable or nothing valid is left. */
function parseStored(raw: unknown): BoardsState | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (!Array.isArray(p.boards)) return null;
  const seen = new Set<string>();
  const boards = p.boards.filter(isBoardMeta).filter((b) => !seen.has(b.id) && !!seen.add(b.id));
  if (p.boards.length > 0 && boards.length === 0) return null;
  const rawItems = p.items && typeof p.items === 'object' ? (p.items as Record<string, unknown>) : {};
  const items: Record<string, BoardItem[]> = {};
  for (const id of [...boards.map((b) => b.id), MAIN_ID]) {
    const list = rawItems[id];
    items[id] = Array.isArray(list) ? list.filter((i) => isBoardItem(i) || isBoardCard(i, seen)) : [];
  }
  const last = typeof p.lastOpenedId === 'string' && seen.has(p.lastOpenedId) ? p.lastOpenedId : null;
  return { boards, items, lastOpenedId: last };
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/**
 * Reads the boards from storage. Order: current key, then the legacy single board
 * (becomes a "Moodboard" if it has items), then an empty canvas.
 */
export function loadBoards(storage: ReadableStorage | null, now = Date.now()): BoardsState {
  const empty: BoardsState = { boards: [], items: { [MAIN_ID]: [] }, lastOpenedId: null };
  if (!storage) return empty;
  try {
    const raw = storage.getItem(BOARDS_STORAGE_KEY);
    if (raw !== null) {
      return parseStored(JSON.parse(raw)) ?? empty;
    }
  } catch {
    return empty;
  }
  try {
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      const parsed: unknown = JSON.parse(legacy);
      const items = Array.isArray(parsed) ? parsed.filter(isBoardItem) : [];
      if (items.length) {
        const board = newMeta('Moodboard', tileSlot(0), now);
        return { boards: [board], items: { ...empty.items, [board.id]: items }, lastOpenedId: null };
      }
    }
  } catch {
    /* ignore a corrupt legacy value */
  }
  return empty;
}

export function saveBoards(storage: WritableStorage | null, state: BoardsState): void {
  if (!storage) return;
  try {
    storage.setItem(
      BOARDS_STORAGE_KEY,
      JSON.stringify({ version: 1, boards: state.boards, items: state.items, lastOpenedId: state.lastOpenedId }),
    );
  } catch {
    /* storage unavailable or full */
  }
}

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Placement
 * ------------------------------------------------------------------ */

/**
 * Where a new card for `ref` goes: centered on the origin for an empty board, otherwise
 * 60px right of the content's right edge, top-aligned with the content.
 */
export function placeRefInBoard(items: BoardItem[], ref: Reference, id: string): Omit<BoardItem, 'z'> {
  if (!items.length) return { id, refId: ref.id, x: -ref.w / 2, y: -ref.h / 2, w: ref.w, h: ref.h };
  const right = Math.max(...items.map((i) => i.x + i.w));
  const top = Math.min(...items.map((i) => i.y));
  return { id, refId: ref.id, x: right + ADD_GAP, y: top, w: ref.w, h: ref.h };
}

/** Like placeRefInBoard, but the overview tiles count as content so main cards never land on them. */
export function placeRefInMain(items: BoardItem[], boards: BoardMeta[], ref: Reference, id: string): Omit<BoardItem, 'z'> {
  const tiles = boards.filter((b) => !b.parentId).map((b): BoardItem => ({ id: b.id, refId: '', x: b.x, y: b.y, w: BOARD_TILE_W, h: BOARD_TILE_H, z: 0 }));
  return placeRefInBoard([...tiles, ...items], ref, id);
}

/**
 * Refs that should be added to the main area: saved by the user or the server, not yet on any
 * board or in main, and never auto-placed before (so a card deleted from main stays gone).
 */
export function refsToAutoPlace(refs: readonly Reference[], state: BoardsState, seen: ReadonlySet<string>): string[] {
  const placed = new Set(Object.values(state.items).flatMap((list) => list.map((i) => i.refId)));
  return refs.filter((r) => (r.userAdded || r.serverId) && !seen.has(r.id) && !placed.has(r.id)).map((r) => r.id);
}

export const MAIN_SEEN_KEY = 'atelier.main.seen.v1';
let mainSeen = new Set<string>();
let seenTimer: ReturnType<typeof setTimeout> | null = null;

function persistSeen(): void {
  if (seenTimer) clearTimeout(seenTimer);
  seenTimer = null;
  try {
    browserStorage()?.setItem(MAIN_SEEN_KEY, JSON.stringify([...mainSeen]));
  } catch {
    /* storage unavailable or full */
  }
}

/** Marks refs as handled so they are never auto-placed in main (e.g. an explicit library-only add). */
export function markMainSeen(ids: string[]): void {
  for (const id of ids) mainSeen.add(id);
  if (seenTimer) clearTimeout(seenTimer);
  seenTimer = setTimeout(persistSeen, SAVE_DEBOUNCE_MS);
}

function readSeen(): string[] | null {
  try {
    const raw = browserStorage()?.getItem(MAIN_SEEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Reducer
 * ------------------------------------------------------------------ */

export type BoardsAction =
  | { type: 'serverPending'; boardId: string }
  | { type: 'serverAssociate'; boardId: string; serverId: string }
  | { type: 'serverRetry'; boardId: string }
  | { type: 'serverMerge'; boards: BoardMeta[]; items: Record<string, BoardItem[]>; removed?: string[] }
  | { type: 'create'; id: string; name: string; at: number }
  | { type: 'createChild'; id: string; parentId: string; name: string; pos: { x: number; y: number }; at: number }
  | { type: 'moveItems'; boardId: string; to: string; ids: string[]; at: number; pos?: { x: number; y: number } }
  | { type: 'rename'; boardId: string; name: string }
  | { type: 'remove'; boardId: string }
  | { type: 'moveTile'; boardId: string; dx: number; dy: number }
  | { type: 'setCamera'; boardId: string; camera: Camera }
  | { type: 'markOpened'; boardId: string }
  | { type: 'items'; boardId: string; action: BoardAction; at: number }
  | { type: 'removeRef'; refId: string; at: number }
  | { type: 'restore'; entries: PlacedItem[]; at: number };

/** `ids` and every board nested under them, at any depth. */
function withDescendants(boards: BoardMeta[], ids: Iterable<string>): Set<string> {
  const all = new Set(ids);
  for (let n = -1; n !== all.size; ) {
    n = all.size;
    for (const b of boards) if (b.parentId && all.has(b.parentId)) all.add(b.id);
  }
  return all;
}

/** root..id following parentId; stops at a missing parent or a cycle. */
export function boardPath(boards: BoardMeta[], id: string): BoardMeta[] {
  const path: BoardMeta[] = [];
  for (let b = boards.find((m) => m.id === id); b && !path.includes(b); b = boards.find((m) => m.id === b!.parentId)) path.unshift(b);
  return path;
}

const patchBoard = (state: BoardsState, boardId: string, patch: (b: BoardMeta) => BoardMeta): BoardsState => {
  if (!state.boards.some((b) => b.id === boardId)) return state;
  return { ...state, boards: state.boards.map((b) => (b.id === boardId ? patch(b) : b)) };
};

/** Pure: drops every item of `refId` from every board and from main. `removed` is what to pass to restoreItemsTo. */
export function removeItemsOfRefFrom(
  state: BoardsState,
  refId: string,
  at: number,
): { state: BoardsState; removed: PlacedItem[] } {
  const removed: PlacedItem[] = [];
  let items = state.items;
  let boards = state.boards;
  for (const id of [...state.boards.map((b) => b.id), MAIN_ID]) {
    const cur = state.items[id] ?? EMPTY;
    const hit = cur.filter((i) => i.refId === refId);
    if (!hit.length) continue;
    for (const item of hit) removed.push({ boardId: id, item });
    items = { ...items, [id]: cur.filter((i) => i.refId !== refId) };
    boards = boards.map((m) => (m.id === id ? { ...m, updatedAt: at } : m));
  }
  return removed.length ? { state: { ...state, boards, items }, removed } : { state, removed };
}

/** Pure: puts removed items back with their ids and coordinates, on top in z order. Unknown boards are skipped. */
export function restoreItemsTo(state: BoardsState, entries: PlacedItem[], at: number): BoardsState {
  let items = state.items;
  let boards = state.boards;
  const byBoard = new Map<string, BoardItem[]>();
  for (const e of entries) {
    if (!state.items[e.boardId]) continue;
    byBoard.set(e.boardId, [...(byBoard.get(e.boardId) ?? []), e.item]);
  }
  for (const [boardId, back] of byBoard) {
    const cur = state.items[boardId];
    const have = new Set(cur.map((i) => i.id));
    let z = cur.reduce((m, i) => Math.max(m, i.z), 0);
    const added = back
      .filter((i) => !have.has(i.id))
      .sort((a, b) => a.z - b.z)
      .map((i) => ({ ...i, z: ++z }));
    if (!added.length) continue;
    items = { ...items, [boardId]: [...cur, ...added] };
    boards = boards.map((m) => (m.id === boardId ? { ...m, updatedAt: at } : m));
  }
  return items === state.items ? state : { ...state, boards, items };
}

export function boardsReducer(state: BoardsState, action: BoardsAction): BoardsState {
  switch (action.type) {
    case 'serverPending': return patchBoard(state, action.boardId, (board) => ({ ...board, serverPending: true }));
    case 'serverAssociate': return patchBoard(state, action.boardId, (board) => ({ ...board, serverId: action.serverId, serverPending: false }));
    case 'serverRetry': return state;
    case 'serverMerge': {
      const removed = withDescendants(state.boards, action.removed ?? []);
      const ids = new Set([...action.boards.map((b) => b.id), ...removed]);
      const items = { ...state.items, ...action.items };
      for (const id of removed) delete items[id];
      return { ...state, boards: [...state.boards.filter((b) => !ids.has(b.id)), ...action.boards], items, lastOpenedId: removed.has(state.lastOpenedId ?? '') ? null : state.lastOpenedId };
    }
    case 'create': {
      const name = action.name.trim() || uniqueBoardName(state.boards);
      const pos = nextTileSlot(state.boards);
      const meta: BoardMeta = {
        id: action.id,
        name,
        x: pos.x,
        y: pos.y,
        camera: null,
        createdAt: action.at,
        updatedAt: action.at,
      };
      return { ...state, boards: [...state.boards, meta], items: { ...state.items, [meta.id]: [] } };
    }
    case 'createChild': {
      const cur = state.items[action.parentId];
      if (!cur) return state;
      const { w, h } = SUBBOARD_SIZE;
      const meta: BoardMeta = { id: action.id, parentId: action.parentId, name: action.name, x: 0, y: 0, camera: null, createdAt: action.at, updatedAt: action.at };
      const card: BoardItem = { id: uid(), refId: '', boardId: meta.id, x: action.pos.x - w / 2, y: action.pos.y - h / 2, w, h, z: cur.reduce((m, i) => Math.max(m, i.z), 0) + 1 };
      const next = patchBoard(state, action.parentId, (b) => ({ ...b, updatedAt: action.at }));
      return { ...next, boards: [...next.boards, meta], items: { ...state.items, [action.parentId]: [...cur, card], [meta.id]: [] } };
    }
    case 'moveItems': {
      const src = state.items[action.boardId];
      const dst = state.items[action.to];
      if (!src || !dst || action.boardId === action.to) return state;
      const ids = new Set(action.ids);
      // A folder can't go into itself or into anything inside it.
      const moved = src.filter((i) => ids.has(i.id) && !(i.boardId && withDescendants(state.boards, [i.boardId]).has(action.to)));
      if (!moved.length) return state;
      const minX = Math.min(...moved.map((i) => i.x));
      const minY = Math.min(...moved.map((i) => i.y));
      const left = action.pos?.x ?? (dst.length ? Math.max(...dst.map((i) => i.x + i.w)) + ADD_GAP : 0);
      const top = action.pos?.y ?? (dst.length ? Math.min(...dst.map((i) => i.y)) : 0);
      let z = dst.reduce((m, i) => Math.max(m, i.z), 0);
      const placed = [...moved].sort((a, b) => a.z - b.z).map((i) => ({ ...i, x: i.x - minX + left, y: i.y - minY + top, z: ++z }));
      const gone = new Set(moved.map((i) => i.id));
      const folders = new Set(moved.flatMap((i) => i.boardId ?? []));
      const boards = state.boards.map((b) =>
        folders.has(b.id) ? { ...b, parentId: action.to, updatedAt: action.at } : b.id === action.boardId || b.id === action.to ? { ...b, updatedAt: action.at } : b,
      );
      return { ...state, boards, items: { ...state.items, [action.boardId]: src.filter((i) => !gone.has(i.id)), [action.to]: [...dst, ...placed] } };
    }
    case 'rename': {
      const name = action.name.trim();
      if (!name) return state;
      return patchBoard(state, action.boardId, (b) => (b.name === name ? b : { ...b, name }));
    }
    case 'remove': {
      if (!state.boards.some((b) => b.id === action.boardId)) return state;
      const gone = withDescendants(state.boards, [action.boardId]);
      const items = Object.fromEntries(Object.entries(state.items).filter(([id]) => !gone.has(id)));
      const parentId = state.boards.find((b) => b.id === action.boardId)?.parentId;
      if (parentId && items[parentId]) items[parentId] = items[parentId].filter((i) => i.boardId !== action.boardId);
      return {
        boards: state.boards.filter((b) => !gone.has(b.id)),
        items,
        lastOpenedId: gone.has(state.lastOpenedId ?? '') ? null : state.lastOpenedId,
      };
    }
    case 'moveTile':
      return patchBoard(state, action.boardId, (b) => ({ ...b, x: b.x + action.dx, y: b.y + action.dy }));
    case 'setCamera':
      return patchBoard(state, action.boardId, (b) => ({ ...b, camera: { ...action.camera } }));
    case 'markOpened':
      if (!state.boards.some((b) => b.id === action.boardId) || state.lastOpenedId === action.boardId) return state;
      return { ...state, lastOpenedId: action.boardId };
    case 'removeRef':
      return removeItemsOfRefFrom(state, action.refId, action.at).state;
    case 'restore':
      return restoreItemsTo(state, action.entries, action.at);
    case 'items': {
      const cur = state.items[action.boardId];
      if (!cur) return state;
      const next = boardReducer({ items: cur, selected: [] }, action.action).items;
      if (next === cur) return state;
      return {
        ...patchBoard(state, action.boardId, (b) => ({ ...b, updatedAt: action.at })),
        items: { ...state.items, [action.boardId]: next },
      };
    }
  }
}

/* ------------------------------------------------------------------ *
 * Hooks
 * ------------------------------------------------------------------ */

interface Internal {
  getItems(boardId: string): BoardItem[];
  run(boardId: string, action: BoardAction): void;
}

const INTERNAL = Symbol('atelier.boards.internal');
type InternalStore = BoardsStore & { [INTERNAL]?: Internal };

export function useBoards(): BoardsStore {
  const [state, dispatch] = useReducer(boardsReducer, undefined, () => loadBoards(browserStorage()));
  const backend = useBackendStatus();
  const serverIds = useRef(new Set<string>());
  const dirty = useRef(new Set<string>());
  const rawBoards = useRef(new Map<string, ServerBoard>());
  const writing = useRef(new Map<string, number>());
  const reported = useRef(new Set<string>());
  const creating = useRef(new Set<string>());
  // Server saves reach the ref store before their boards merge in; hold auto-place until then.
  const settling = useRef(false);
  // No seen list at mount: existing refs are marked seen then, and server refs that arrive with the first merge too.
  const baseline = useRef(false);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirrors the reduced state synchronously so several calls in one tick see each other.
  const ref = useRef(state);
  const send = useCallback((action: BoardsAction) => {
    ref.current = boardsReducer(ref.current, action);
    dispatch(action);
    if (action.type !== 'serverMerge' && action.type !== 'serverAssociate' && action.type !== 'serverPending') {
      const ids = action.type === 'moveItems' ? [action.boardId, action.to] : 'boardId' in action ? [action.boardId] : action.type === 'removeRef' || action.type === 'restore' ? [...serverIds.current] : [];
      for (const id of ids) if (serverIds.current.has(id)) dirty.current.add(id);
      if (ids.length && timer.current) clearTimeout(timer.current);
      if (ids.length) timer.current = setTimeout(() => {
        const pending = [...dirty.current];
        for (const id of pending) {
          dirty.current.delete(id);
          writing.current.set(id, (writing.current.get(id) ?? 0) + 1);
          const snapshot = ref.current;
          const meta = snapshot.boards.find((b) => b.id === id);
          const remoteId = meta?.serverId ?? rawBoards.current.get(id)?.id ?? id;
          queue.current = queue.current.then(async () => {
            try {
              if (!meta) { await deleteProject(remoteId); serverIds.current.delete(id); return; }
              await renameProject(remoteId, meta.name);
              const items = (snapshot.items[id] ?? []).flatMap((item) => {
                const saveId = refsStore.get(item.refId)?.serverId;
                return saveId ? [{ ...item, type: 'save' as const, saveId, text: null }] : [];
              });
              const base = rawBoards.current.get(id);
              const latest = await getProjectBoard(remoteId);
              const baseIds = new Set((base?.items ?? []).map((item) => item.id));
              const currentIds = new Set(items.map((item) => item.id));
              const preserved = latest.items.filter((item) => !currentIds.has(item.id) && (!baseIds.has(item.id) || item.type === 'note' || (item.saveId && !refsStore.getSnapshot().list.some((r) => r.serverId === item.saveId))));
              const board = await putProjectBoard({ id: remoteId, items: [...items, ...preserved], camera: meta.camera ?? { x: 0, y: 0, zoom: 1 } });
              rawBoards.current.set(id, board);
              reported.current.delete(id);
            } catch (error) {
              if (!meta && error instanceof ApiClientError && error.status === 409) dirty.current.delete(id);
              else dirty.current.add(id);
              if (!reported.current.has(id)) { reported.current.add(id); window.dispatchEvent(new Event('atelier-board-sync-error')); }
            } finally {
              const remaining = (writing.current.get(id) ?? 1) - 1;
              if (remaining) writing.current.set(id, remaining);
              else writing.current.delete(id);
            }
          });
        }
      }, 500);
    }
  }, []);
  const autoPlaceRef = useRef(() => {});
  const createRemote = useCallback((id: string) => {
    const board = ref.current.boards.find((b) => b.id === id);
    if (!board || creating.current.has(id)) return;
    creating.current.add(id);
    void createProject(board.name).then((project) => {
      if (!ref.current.boards.some((b) => b.id === id)) { void deleteProject(project.id).catch(() => {}); return; }
      serverIds.current.add(id);
      rawBoards.current.set(id, { id: project.id, items: [], camera: { x: 0, y: 0, zoom: 1 } });
      send({ type: 'serverAssociate', boardId: id, serverId: project.id });
      send({ type: 'serverRetry', boardId: id });
    }).catch(() => {
      if (!reported.current.has(id)) { reported.current.add(id); window.dispatchEvent(new Event('atelier-board-sync-error')); }
    }).finally(() => creating.current.delete(id));
  }, [send]);

  useEffect(() => {
    ref.current = state;
  }, [state]);

  useEffect(() => {
    if (backend !== 'connected') return;
    let alive = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      for (const board of ref.current.boards) if (board.serverPending) createRemote(board.id);
      for (const id of dirty.current) if (!writing.current.has(id)) send({ type: 'serverRetry', boardId: id });
      loading = true;
      settling.current = true;
      try {
        await refreshServerSaves();
        await queue.current;
        const { projects } = await listProjects();
        const remote = await Promise.all(projects.map(async (project) => ({ project, board: await getProjectBoard(project.id) })));
        if (!alive) return;
        const metas: BoardMeta[] = [];
        const items: Record<string, BoardItem[]> = {};
        for (const { project, board } of remote) {
          const previous = ref.current.boards.find((b) => b.id === project.id || b.serverId === project.id);
          const localId = previous?.id ?? project.id;
          serverIds.current.add(localId);
          if (dirty.current.has(localId) || writing.current.has(localId)) continue;
          rawBoards.current.set(localId, board);
          const pos = previous ?? nextTileSlot([...ref.current.boards, ...metas]);
          const camera = board.camera.x === 0 && board.camera.y === 0 && board.camera.zoom === 1 ? null : board.camera;
          metas.push({ id: localId, parentId: previous?.parentId, serverId: localId === project.id ? undefined : project.id, name: project.name, x: pos.x, y: pos.y, camera, createdAt: Date.parse(project.createdAt), updatedAt: Date.parse(project.updatedAt) });
          const byServerId = new Map(refsStore.getSnapshot().list.filter((r) => r.serverId).map((r) => [r.serverId, r.id]));
          const fromServer = board.items.flatMap((item) => {
            const refId = item.saveId && byServerId.get(item.saveId);
            return refId ? [{ id: item.id, refId, x: item.x, y: item.y, w: item.w, h: item.h, z: item.z }] : [];
          });
          const localOnly = (ref.current.items[localId] ?? []).filter((item) => { const ref = refsStore.get(item.refId); return item.boardId || (ref && !ref.serverId); });
          items[localId] = [...fromServer, ...localOnly];
        }
        const remoteIds = new Set(projects.map((project) => project.id));
        const removed = [...serverIds.current].filter((id) => {
          const board = ref.current.boards.find((b) => b.id === id);
          return board && !board.serverPending && !remoteIds.has(board.serverId ?? id) && !dirty.current.has(id) && !writing.current.has(id);
        });
        for (const id of removed) { serverIds.current.delete(id); rawBoards.current.delete(id); }
        send({ type: 'serverMerge', boards: metas, items, removed });
        settling.current = false;
        if (baseline.current) {
          baseline.current = false;
          markMainSeen(refsStore.getSnapshot().list.map((r) => r.id));
        }
        setTimeout(() => autoPlaceRef.current(), 0);
      } catch { /* Preserve local state and retry on the next refresh. */ }
      finally { loading = false; }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), 5000);
    return () => { alive = false; settling.current = false; clearInterval(interval); };
  }, [backend, send, createRemote]);

  useEffect(() => refsStore.subscribe(() => {
    if (backend !== 'connected') return;
    for (const id of serverIds.current) {
      const known = new Set((rawBoards.current.get(id)?.items ?? []).map((item) => item.id));
      if ((ref.current.items[id] ?? []).some((item) => !known.has(item.id) && refsStore.get(item.refId)?.serverId)) send({ type: 'serverRetry', boardId: id });
    }
  }), [backend, send]);

  // Link cards are placed at LINK_SIZE; once the reference is refit to its preview, refit those cards.
  useEffect(() => {
    const fit = () => {
      for (const [boardId, items] of Object.entries(ref.current.items)) {
        const sizes: Record<string, { w: number; h: number }> = {};
        for (const item of items) {
          const r = refsStore.get(item.refId);
          if (r?.kind === 'link' && item.w === LINK_SIZE.w && item.h === LINK_SIZE.h && r.h !== LINK_SIZE.h) sizes[item.id] = { w: r.w, h: r.h };
        }
        if (Object.keys(sizes).length) send({ type: 'items', boardId, action: { type: 'resize', sizes }, at: Date.now() });
      }
    };
    fit();
    return refsStore.subscribe(fit);
  }, [send]);

  useEffect(() => {
    const t = setTimeout(() => saveBoards(browserStorage(), state), SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [state]);

  const internal = useMemo<Internal>(
    () => ({
      getItems: (boardId) => ref.current.items[boardId] ?? EMPTY,
      run: (boardId, action) => send({ type: 'items', boardId, action, at: Date.now() }),
    }),
    [send],
  );

  const addRef = useCallback((boardId: string, refId: string) => {
    const r = refsStore.get(refId);
    const cur = ref.current.items[boardId];
    if (!r || !cur) return null;
    const item = boardId === MAIN_ID ? placeRefInMain(cur, ref.current.boards, r, uid()) : placeRefInBoard(cur, r, uid());
    internal.run(boardId, { type: 'add', item });
    return item.id;
  }, [internal]);

  // Every new save also lands in main. Deferred a tick: refsStore notifies before the add flow
  // (useAddActions) has placed the ref, and the check re-reads boards/main at that point.
  useEffect(() => {
    const placeNew = () => {
      if (settling.current) return;
      const ids = refsToAutoPlace(refsStore.getSnapshot().list, ref.current, mainSeen);
      markMainSeen(ids);
      for (const id of ids) addRef(MAIN_ID, id);
    };
    autoPlaceRef.current = placeNew;
    const stored = readSeen();
    mainSeen = new Set(stored ?? refsStore.getSnapshot().list.map((r) => r.id));
    if (!stored) {
      baseline.current = true;
      persistSeen();
    }
    let t: ReturnType<typeof setTimeout>;
    const run = () => {
      clearTimeout(t);
      t = setTimeout(placeNew, 0);
    };
    run();
    const off = refsStore.subscribe(run);
    return () => {
      off();
      clearTimeout(t);
      persistSeen();
    };
  }, [addRef]);

  return useMemo(() => {
    const store: InternalStore = {
      boards: state.boards,
      lastOpenedId: state.lastOpenedId,
      itemsOf: (boardId) => state.items[boardId] ?? EMPTY,
      create(name) {
        const id = uid();
        send({ type: 'create', id, name, at: Date.now() });
        if (backend === 'connected') {
          send({ type: 'serverPending', boardId: id });
          createRemote(id);
        }
        return id;
      },
      rename: (boardId, name) => send({ type: 'rename', boardId, name }),
      moveItems: (boardId, ids, to, pos) => send({ type: 'moveItems', boardId, to, ids, at: Date.now(), pos }),
      createChild(parentId, pos, name = 'Untitled board') {
        // ponytail: child boards stay local-only (no server project); only roots sync. Ceiling: nested boards are lost with local storage.
        const id = uid();
        send({ type: 'createChild', id, parentId, name, pos, at: Date.now() });
        return id;
      },
      remove: (boardId) => send({ type: 'remove', boardId }),
      moveTile: (boardId, dx, dy) => send({ type: 'moveTile', boardId, dx, dy }),
      setCamera: (boardId, camera) => send({ type: 'setCamera', boardId, camera }),
      markOpened: (boardId) => send({ type: 'markOpened', boardId }),
      addRef,
      boardsContaining: (refId) => boardsContaining(state, refId),
      removeItemsOfRef(refId) {
        const at = Date.now();
        const { removed } = removeItemsOfRefFrom(ref.current, refId, at);
        if (removed.length) send({ type: 'removeRef', refId, at });
        return removed;
      },
      restoreItems(entries) {
        if (entries.length) send({ type: 'restore', entries, at: Date.now() });
      },
    };
    Object.defineProperty(store, INTERNAL, { value: internal, enumerable: false });
    return store;
  }, [state, send, internal, addRef, backend, createRemote]);
}

/** Pure: which boards hold `refId`. */
export function boardsContaining(state: BoardsState, refId: string): BoardMeta[] {
  return state.boards.filter((b) => (state.items[b.id] ?? EMPTY).some((i) => i.refId === refId));
}

/** One board of the store as the canvas-facing `Board`. Selection is local and resets per board. */
export function useBoard(store: BoardsStore, boardId: string): Board {
  const internal = (store as InternalStore)[INTERNAL];
  if (!internal) throw new Error('useBoard: store was not created by useBoards()');
  const items = store.itemsOf(boardId);

  const [sel, setSel] = useState<{ boardId: string; ids: string[] }>({ boardId, ids: [] });
  const selectedIds = sel.boardId === boardId ? sel.ids : EMPTY_IDS;
  const selected = useMemo(() => {
    const live = new Set(items.map((i) => i.id));
    return new Set(selectedIds.filter((id) => live.has(id)));
  }, [items, selectedIds]);

  const act = useCallback(
    (action: BoardAction) => {
      const before = internal.getItems(boardId);
      setSel((prev) => {
        const ids = prev.boardId === boardId ? prev.ids : [];
        return { boardId, ids: boardReducer({ items: before, selected: ids }, action).selected };
      });
      if (action.type !== 'select') internal.run(boardId, action);
    },
    [internal, boardId],
  );

  return {
    items,
    selected,
    add: useCallback(
      (refId, worldX, worldY) => {
        const r = refsStore.get(refId);
        if (!r) return;
        act({
          type: 'add',
          item: { id: uid(), refId, x: worldX - r.w / 2, y: worldY - r.h / 2, w: r.w, h: r.h },
        });
      },
      [act],
    ),
    move: useCallback((ids, dx, dy) => act({ type: 'move', ids, dx, dy }), [act]),
    resize: useCallback((sizes) => act({ type: 'resize', sizes }), [act]),
    remove: useCallback((ids) => act({ type: 'remove', ids }), [act]),
    duplicate: useCallback((ids) => act({ type: 'duplicate', ids, newIds: ids.map(uid) }), [act]),
    bringToFront: useCallback((ids) => act({ type: 'front', ids }), [act]),
    select: useCallback((ids, additive = false) => act({ type: 'select', ids, additive }), [act]),
    replace: useCallback((next) => act({ type: 'replace', items: next }), [act]),
    append: useCallback((next) => act({ type: 'append', items: next }), [act]),
  };
}

const EMPTY_IDS: string[] = [];
