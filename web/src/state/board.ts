import { useCallback, useMemo, useReducer } from 'react';
import type { BoardItem } from '../types';
import { refsStore } from '../refs/store';

const DUPLICATE_OFFSET = 24;

export function uid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `i-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export interface BoardState {
  items: BoardItem[];
  selected: string[];
}

export type BoardAction =
  | { type: 'add'; item: Omit<BoardItem, 'z'> }
  | { type: 'move'; ids: string[]; dx: number; dy: number }
  | { type: 'remove'; ids: string[] }
  | { type: 'duplicate'; ids: string[]; newIds: string[] }
  | { type: 'replace'; items: BoardItem[] }
  | { type: 'append'; items: BoardItem[] }
  | { type: 'front'; ids: string[] }
  | { type: 'resize'; sizes: Record<string, Partial<Pick<BoardItem, 'x' | 'y' | 'w' | 'h'>>> }
  | { type: 'select'; ids: string[]; additive: boolean };

const topZ = (items: BoardItem[]) => items.reduce((m, i) => Math.max(m, i.z), 0);

export type Corner = 'tl' | 'tr' | 'bl' | 'br';
type Box = Pick<BoardItem, 'x' | 'y' | 'w' | 'h'>;

/** Aspect-locked resize from a corner dragged by (dx, dy) world px; the opposite corner stays put. */
export function resizeFromCorner(o: Box, corner: Corner, dx: number, dy: number, min = 40): Box {
  const sx = corner[1] === 'r' ? 1 : -1;
  const sy = corner[0] === 'b' ? 1 : -1;
  // Project the dragged corner onto the box's diagonal so shrinking and growing feel the same.
  const s = Math.max(min / Math.min(o.w, o.h), ((o.w + sx * dx) * o.w + (o.h + sy * dy) * o.h) / (o.w * o.w + o.h * o.h));
  const w = o.w * s;
  const h = o.h * s;
  return { x: sx > 0 ? o.x : o.x + o.w - w, y: sy > 0 ? o.y : o.y + o.h - h, w, h };
}

/** Ids of items overlapping the rectangle spanned by world points a and b. */
export function idsInRect(items: BoardItem[], a: { x: number; y: number }, b: { x: number; y: number }): string[] {
  const [x0, x1] = a.x < b.x ? [a.x, b.x] : [b.x, a.x];
  const [y0, y1] = a.y < b.y ? [a.y, b.y] : [b.y, a.y];
  return items.filter((i) => i.x < x1 && i.x + i.w > x0 && i.y < y1 && i.y + i.h > y0).map((i) => i.id);
}

export function reducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case 'add':
      return {
        items: [...state.items, { ...action.item, z: topZ(state.items) + 1 }],
        selected: [action.item.id],
      };
    case 'replace':
      return { items: action.items, selected: [] };
    case 'resize':
      return { ...state, items: state.items.map((i) => (action.sizes[i.id] ? { ...i, ...action.sizes[i.id] } : i)) };
    case 'append': {
      let z = topZ(state.items);
      const added = [...action.items].sort((a, b) => a.z - b.z).map((i) => ({ ...i, z: ++z }));
      return { items: [...state.items, ...added], selected: added.map((i) => i.id) };
    }
    case 'move': {
      const ids = new Set(action.ids);
      return {
        ...state,
        items: state.items.map((i) =>
          ids.has(i.id) ? { ...i, x: i.x + action.dx, y: i.y + action.dy } : i,
        ),
      };
    }
    case 'remove': {
      const ids = new Set(action.ids);
      return {
        items: state.items.filter((i) => !ids.has(i.id)),
        selected: state.selected.filter((id) => !ids.has(id)),
      };
    }
    case 'duplicate': {
      const map = new Map(action.ids.map((id, n) => [id, action.newIds[n]]));
      let z = topZ(state.items);
      const copies = state.items
        .filter((i) => map.has(i.id) && !i.boardId) // a copied sub-board card would alias the same child
        .sort((a, b) => a.z - b.z)
        .map((i) => ({
          ...i,
          id: map.get(i.id)!,
          x: i.x + DUPLICATE_OFFSET,
          y: i.y + DUPLICATE_OFFSET,
          z: ++z,
        }));
      return { items: [...state.items, ...copies], selected: copies.map((c) => c.id) };
    }
    case 'front': {
      const ids = new Set(action.ids);
      let z = topZ(state.items);
      const order = state.items.filter((i) => ids.has(i.id)).sort((a, b) => a.z - b.z);
      if (order.length && order[order.length - 1].z === z && order.every((i, n) => i.z === z - (order.length - 1 - n))) {
        return state; // already on top
      }
      const next = new Map(order.map((i) => [i.id, ++z]));
      return { ...state, items: state.items.map((i) => (next.has(i.id) ? { ...i, z: next.get(i.id)! } : i)) };
    }
    case 'select': {
      if (!action.additive) return { ...state, selected: action.ids };
      const sel = new Set(state.selected);
      for (const id of action.ids) {
        if (sel.has(id)) sel.delete(id);
        else sel.add(id);
      }
      return { ...state, selected: [...sel] };
    }
  }
}

export interface Board {
  items: BoardItem[];
  selected: ReadonlySet<string>;
  add(refId: string, worldX: number, worldY: number): void;
  move(ids: string[], dx: number, dy: number): void;
  /** Set position and/or size per item id. */
  resize(sizes: Record<string, Partial<Pick<BoardItem, 'x' | 'y' | 'w' | 'h'>>>): void;
  remove(ids: string[]): void;
  duplicate(ids: string[]): void;
  bringToFront(ids: string[]): void;
  select(ids: string[], additive?: boolean): void;
  /** Swap the whole item list (clears selection). */
  replace(items: BoardItem[]): void;
  /** Add existing items on top, in their current z order, and select them. */
  append(items: BoardItem[]): void;
}

/** A transient, never-persisted board used by the search view. */
export function useViewBoard(): Board {
  return useItemsStore();
}

function useItemsStore(): Board {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({ items: [], selected: [] }));

  const selected = useMemo(() => new Set(state.selected), [state.selected]);

  const add = useCallback((refId: string, worldX: number, worldY: number) => {
    const ref = refsStore.get(refId);
    if (!ref) return;
    dispatch({
      type: 'add',
      item: { id: uid(), refId, x: worldX - ref.w / 2, y: worldY - ref.h / 2, w: ref.w, h: ref.h },
    });
  }, []);

  return {
    items: state.items,
    selected,
    add,
    move: useCallback((ids, dx, dy) => dispatch({ type: 'move', ids, dx, dy }), []),
    resize: useCallback((sizes) => dispatch({ type: 'resize', sizes }), []),
    remove: useCallback((ids) => dispatch({ type: 'remove', ids }), []),
    duplicate: useCallback((ids) => dispatch({ type: 'duplicate', ids, newIds: ids.map(uid) }), []),
    bringToFront: useCallback((ids) => dispatch({ type: 'front', ids }), []),
    select: useCallback((ids, additive = false) => dispatch({ type: 'select', ids, additive }), []),
    replace: useCallback((items) => dispatch({ type: 'replace', items }), []),
    append: useCallback((items) => dispatch({ type: 'append', items }), []),
  };
}
