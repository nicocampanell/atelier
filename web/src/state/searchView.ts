import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardItem, Camera, Reference } from '../types';
import { FRAME_PAD } from '../canvas/surfaceBridge';
import type { CameraApi } from '../canvas/useCamera';
import { uid, type Board } from './board';

/** Card width and the gap between frames, in world px. */
const COL_W = 240;
const GUTTER = 36;
const PITCH = COL_W + FRAME_PAD * 2 + GUTTER;
/** Temporary result blocks always stack above regular board items. */
export const VIEW_Z_BASE = 1_000_000;

const ENTER_STEP = 45;
const ENTER_MAX = 600;
const EXIT_STEP = 20;
const EXIT_MAX = 300;
const EXIT_MS = 180;
/** How long kept results glide to their new spot (matches canvas.css). */
export const SETTLE_MS = 420;
/** Gap between the existing board and a kept cluster, in world px. */
const KEEP_GAP = 120;

export const FIT_MIN_ZOOM = 0.35;

export interface SearchView {
  label: string;
  /** The camera as it was before the first search view opened. */
  prevCamera: Camera;
  /** Enter stagger delay (ms) per temp item id. Items added later have none and appear instantly. */
  enter: ReadonlyMap<string, number>;
  /** Keep was pressed: results are gliding to free space before joining the board. */
  settling?: boolean;
}

export interface LeavingItem {
  item: BoardItem;
  delay: number;
}

/** Reading order (y, then x) with a capped per-item stagger. */
function stagger(items: BoardItem[], step: number, max: number): Map<string, number> {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const s = order.length > 1 ? Math.min(step, max / (order.length - 1)) : 0;
  return new Map(order.map((it, i) => [it.id, Math.round(i * s)]));
}

/** Shortest-column masonry, centered on `center` (world px). */
export function layoutResults(refs: Reference[], center: { x: number; y: number }): BoardItem[] {
  const n = refs.length;
  if (!n) return [];
  const cols = Math.min(5, Math.max(1, Math.round(Math.sqrt(n * 1.3))));
  const heights = new Array<number>(cols).fill(0);
  const placed = refs.map((ref, idx) => {
    let c = 0;
    for (let k = 1; k < cols; k++) if (heights[k] < heights[c]) c = k;
    const h = Math.max(1, Math.round((ref.h * COL_W) / ref.w));
    const x = c * PITCH;
    const y = heights[c];
    heights[c] += h + FRAME_PAD * 2 + GUTTER;
    return { id: uid(), refId: ref.id, x, y, w: COL_W, h, z: VIEW_Z_BASE + idx + 1 };
  });
  const minX = Math.min(...placed.map((i) => i.x));
  const maxX = Math.max(...placed.map((i) => i.x + i.w));
  const minY = Math.min(...placed.map((i) => i.y));
  const maxY = Math.max(...placed.map((i) => i.y + i.h));
  const dx = center.x - (minX + maxX) / 2;
  const dy = center.y - (minY + maxY) / 2;
  return placed.map((i) => ({ ...i, x: Math.round(i.x + dx), y: Math.round(i.y + dy) }));
}

/** Room above the cluster for the results bar and selection menu. */
const TOP_CLEARANCE = 56;

/** Bounds include the frame padding so the fit keeps the frames on screen. */
const withFrames = (items: BoardItem[]): BoardItem[] =>
  items.map((i) => ({
    ...i,
    x: i.x - FRAME_PAD,
    y: i.y - FRAME_PAD - TOP_CLEARANCE,
    w: i.w + FRAME_PAD * 2,
    h: i.h + FRAME_PAD * 2 + TOP_CLEARANCE,
  }));

const framed = (i: BoardItem) => ({
  l: i.x - FRAME_PAD,
  t: i.y - FRAME_PAD,
  r: i.x + i.w + FRAME_PAD,
  b: i.y + i.h + FRAME_PAD,
});

/**
 * Returns `items` unchanged when they overlap nothing on the board; otherwise
 * a copy moved as a group to the right of the board, top-aligned with it.
 */
export function placeBeside(items: BoardItem[], board: BoardItem[]): BoardItem[] {
  if (!items.length || !board.length) return items;
  const hits = items.some((a) => {
    const fa = framed(a);
    return board.some((o) => {
      const fo = framed(o);
      return fa.l < fo.r && fa.r > fo.l && fa.t < fo.b && fa.b > fo.t;
    });
  });
  if (!hits) return items;
  const boardR = Math.max(...board.map((o) => framed(o).r));
  const boardT = Math.min(...board.map((o) => framed(o).t));
  const clusterL = Math.min(...items.map((i) => framed(i).l));
  const clusterT = Math.min(...items.map((i) => framed(i).t));
  const dx = boardR + KEEP_GAP - clusterL;
  const dy = boardT - clusterT;
  return items.map((i) => ({ ...i, x: Math.round(i.x + dx), y: Math.round(i.y + dy) }));
}

/**
 * The transient "search on canvas" view. Results live in `viewBoard`
 * (never persisted); regular board items stay untouched underneath.
 */
export function useSearchView(board: Board, viewBoard: Board, camera: CameraApi) {
  const [view, setView] = useState<SearchView | null>(null);
  const [leaving, setLeaving] = useState<LeavingItem[]>([]);

  const latest = useRef({ board, viewBoard, view });
  useEffect(() => {
    latest.current = { board, viewBoard, view };
  });
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const t = timers.current;
    return () => t.forEach((id) => window.clearTimeout(id));
  }, []);

  const sendOut = useCallback((items: BoardItem[]) => {
    if (!items.length) return;
    const delays = stagger(items, EXIT_STEP, EXIT_MAX);
    const out = items.map((item) => ({ item, delay: delays.get(item.id) ?? 0 }));
    setLeaving((cur) => [...cur.filter((l) => !delays.has(l.item.id)), ...out]);
    const ids = new Set(items.map((i) => i.id));
    const t = window.setTimeout(
      () => {
        timers.current.delete(t);
        setLeaving((cur) => cur.filter((l) => !ids.has(l.item.id)));
      },
      EXIT_MS + Math.max(...out.map((o) => o.delay)) + 60,
    );
    timers.current.add(t);
  }, []);

  const show = useCallback(
    (refs: Reference[], label: string) => {
      const { board: b, viewBoard: vb, view: v } = latest.current;
      const items = layoutResults(refs, camera.center());
      if (!items.length) return;
      if (v) sendOut(vb.items);
      else b.select([], false);
      vb.replace(items);
      const next: SearchView = {
        label,
        prevCamera: v ? v.prevCamera : { ...camera.get() },
        enter: stagger(items, ENTER_STEP, ENTER_MAX),
      };
      latest.current.view = next;
      setView(next);
      camera.fitToContent(withFrames(items), { animate: true, minZoom: FIT_MIN_ZOOM, maxZoom: 1 });
    },
    [camera, sendOut],
  );

  /** Exit animation, board returns, camera goes back. */
  const done = useCallback(() => {
    const { viewBoard: vb, view: v } = latest.current;
    if (!v || v.settling) return;
    latest.current.view = null;
    sendOut(vb.items);
    vb.replace([]);
    setView(null);
    camera.animateTo(v.prevCamera, true);
  }, [camera, sendOut]);

  /**
   * Turn the temp items into real board items. If the cluster sits on top of
   * the board, it first glides into free space to the board's right, then
   * joins it; the camera fits everything.
   */
  const keep = useCallback(() => {
    const { board: b, viewBoard: vb, view: v } = latest.current;
    if (!v || v.settling) return;
    const items = vb.items;
    const commit = (final: BoardItem[]) => {
      latest.current.view = null;
      vb.replace([]);
      setView(null);
      if (final.length) b.append(final);
    };
    const placed = placeBeside(items, b.items);
    if (placed === items) return commit(items);
    const settling: SearchView = { ...v, settling: true, enter: new Map() };
    latest.current.view = settling;
    setView(settling);
    vb.replace(placed);
    camera.fitToContent(withFrames([...b.items, ...placed]), {
      animate: true,
      minZoom: FIT_MIN_ZOOM,
      maxZoom: 1,
    });
    const t = window.setTimeout(() => {
      timers.current.delete(t);
      commit(latest.current.viewBoard.items);
    }, SETTLE_MS + 40);
    timers.current.add(t);
  }, [camera]);

  /** Move some results onto the board now; the rest stay. Returns how many were added. */
  const keepItems = useCallback(
    (ids: string[]) => {
      const { board: b, viewBoard: vb, view: v } = latest.current;
      if (!v || v.settling) return 0;
      const set = new Set(ids);
      const picked = vb.items.filter((i) => set.has(i.id));
      if (!picked.length) return 0;
      if (picked.length === vb.items.length) keep();
      else {
        b.append(placeBeside(picked, b.items));
        vb.remove(picked.map((i) => i.id));
      }
      return picked.length;
    },
    [keep],
  );

  // Deleting every result ends the view quietly.
  const count = viewBoard.items.length;
  useEffect(() => {
    if (view && count === 0) {
      setView(null);
      camera.animateTo(view.prevCamera, true);
    }
  }, [view, count, camera]);

  return { view, leaving, show, done, keep, keepItems };
}
