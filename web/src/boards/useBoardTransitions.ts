import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Camera } from '../types';
import { MAIN_ID, type BoardsStore } from '../state/contracts';
import type { Route } from '../state/route';
import { cubicBezier, fitCamera, type CameraApi } from '../canvas/useCamera';
import { compensate, overviewFit, zoomGeometry } from './geometry';

export type Transition =
  | { kind: 'enter'; id: string; stage: 'zoom' | 'swap' }
  | { kind: 'exit'; id: string; stage: 'fit' | 'swap' | 'out' };

export const ENTER_MS = 520;
export const EXIT_FIT_MS = 260;
export const FADE_MS = 160;
export const EASE_IN_OUT = cubicBezier(0.65, 0, 0.35, 1);
const EASE_OUT = cubicBezier(0.23, 1, 0.32, 1);
const SAVE_DEBOUNCE_MS = 500;

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const routeIs = (r: Route, kind: Transition['kind'], id: string) =>
  kind === 'enter' ? r.name === 'board' && r.id === id : r.name === 'boards';

interface Geo {
  id: string;
  zoomed: Camera;
  fit: Camera;
  overview: Camera;
}

interface Options {
  camera: CameraApi;
  store: BoardsStore;
  route: Route;
  setRoute(next: Route): void;
  /** The overview layer element; it carries the compensating transform at the swap. */
  layerRef: RefObject<HTMLDivElement | null>;
  /** Called as an exit starts (closes a search view). */
  beforeExit(): void;
}

/**
 * Drives the shared-element zoom between the overview and a board.
 * Stages (enter): zoom -> swap -> idle. Stages (exit): fit -> swap -> out -> idle.
 */
export function useBoardTransitions(o: Options) {
  const { camera, layerRef } = o;
  const [t, setT] = useState<Transition | null>(null);
  const tRef = useRef<Transition | null>(null);
  const geo = useRef<Geo | null>(null);
  const latest = useRef(o);
  const timers = useRef(new Set<number>());
  /** Routes this hook navigated to itself; the route-sync effect must not re-seat the camera for them. */
  const expected = useRef<string | null>(null);
  /** The visual part is over; waiting for the hash route to catch up before going idle. */
  const settled = useRef(false);

  useLayoutEffect(() => {
    latest.current = o;
  });
  useEffect(() => {
    const set = timers.current;
    return () => set.forEach((id) => window.clearTimeout(id));
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const go = useCallback((next: Transition | null) => {
    tRef.current = next;
    setT(next);
  }, []);

  const finish = useCallback(() => {
    const cur = tRef.current;
    if (!cur || !settled.current) return;
    if (!routeIs(latest.current.route, cur.kind, cur.id)) return; // the route effect retries
    settled.current = false;
    expected.current = null;
    go(null);
  }, [go]);

  const trySettle = useCallback(() => {
    settled.current = true;
    finish();
  }, [finish]);

  /* ---------- enter ---------- */
  const toEnterSwap = useCallback(
    (id: string) => {
      const { store, setRoute } = latest.current;
      go({ kind: 'enter', id, stage: 'swap' });
      if (store.lastOpenedId !== id) store.markOpened(id);
      expected.current = `board:${id}`;
      setRoute({ name: 'board', id });
      later(FADE_MS + 20, trySettle);
    },
    [go, later, trySettle],
  );

  const enter = useCallback(
    (id: string): boolean => {
      const { store, route, camera: cam } = latest.current;
      if (tRef.current || route.name !== 'boards') return false;
      const meta = store.boards.find((b) => b.id === id);
      const { w, h } = cam.frameSize();
      if (!meta || !w) return false;
      const g = zoomGeometry(meta, store.itemsOf(id), w, h);
      geo.current = { id, ...g, overview: overviewFit(store.boards, w, h, store.itemsOf(MAIN_ID)) };
      settled.current = false;
      go({ kind: 'enter', id, stage: 'zoom' });
      if (reduced()) toEnterSwap(id);
      else cam.animateTo(g.zoomed, { duration: ENTER_MS, easing: EASE_IN_OUT, onDone: () => toEnterSwap(id) });
      return true;
    },
    [go, toEnterSwap],
  );

  /* ---------- exit ---------- */
  const toExitSwap = useCallback(
    (id: string) => {
      go({ kind: 'exit', id, stage: 'swap' });
      later(FADE_MS, () => {
        const { setRoute } = latest.current;
        expected.current = 'boards';
        setRoute({ name: 'boards' });
        go({ kind: 'exit', id, stage: 'out' });
      });
    },
    [go, later],
  );

  const exit = useCallback((): boolean => {
    const { store, route, camera: cam, beforeExit } = latest.current;
    if (tRef.current || route.name !== 'board') return false;
    const id = route.id;
    const meta = store.boards.find((b) => b.id === id);
    const { w, h } = cam.frameSize();
    if (!meta || !w) return false;
    beforeExit();
    // Remember where the user was so returning restores it.
    store.setCamera(id, { ...cam.get() });
    const g = zoomGeometry(meta, store.itemsOf(id), w, h);
    geo.current = { id, ...g, overview: overviewFit(store.boards, w, h, store.itemsOf(MAIN_ID)) };
    settled.current = false;
    go({ kind: 'exit', id, stage: 'fit' });
    if (reduced()) {
      cam.jump(g.fit);
      toExitSwap(id);
    } else {
      cam.animateTo(g.fit, { duration: EXIT_FIT_MS, easing: EASE_OUT, onDone: () => toExitSwap(id) });
    }
    return true;
  }, [go, toExitSwap]);

  /* Camera and layer writes that must land in the same commit as the stage's DOM. */
  useLayoutEffect(() => {
    const g = geo.current;
    if (!t || !g) return;
    const layer = layerRef.current;
    if (t.kind === 'enter' && t.stage === 'swap') {
      camera.jump(g.fit);
      if (layer) layer.style.transform = compensate(g.zoomed, g.fit);
    } else if (t.kind === 'exit' && t.stage === 'swap') {
      if (layer) layer.style.transform = compensate(g.zoomed, g.fit);
    } else if (t.kind === 'exit' && t.stage === 'out') {
      camera.jump(g.zoomed);
      if (layer) layer.style.transform = '';
      if (reduced()) {
        camera.jump(g.overview);
        later(FADE_MS, trySettle);
      } else {
        camera.animateTo(g.overview, { duration: ENTER_MS, easing: EASE_IN_OUT, onDone: trySettle });
      }
    }
  }, [t, camera, layerRef, later, trySettle]);

  /* ---------- direct navigation (hash, back button, library) ---------- */
  const routeKey = o.route.name === 'board' ? `board:${o.route.id}` : o.route.name;
  useLayoutEffect(() => {
    const { route, store, camera: cam } = latest.current;
    if (tRef.current) {
      finish();
      return;
    }
    if (expected.current === routeKey) {
      expected.current = null;
      return;
    }
    expected.current = null;
    const { w, h } = cam.frameSize();
    if (!w) return;
    if (route.name === 'boards') cam.jump(overviewFit(store.boards, w, h, store.itemsOf(MAIN_ID)));
    else if (route.name === 'board') {
      const meta = store.boards.find((b) => b.id === route.id);
      if (!meta) return;
      cam.jump(meta.camera ?? fitCamera(store.itemsOf(meta.id), w, h, { maxZoom: 1 }));
      if (store.lastOpenedId !== meta.id) store.markOpened(meta.id);
    }
  }, [routeKey, finish]);

  return { t, enter, exit };
}

/**
 * Saves the board's camera (debounced) while it is idle on screen, and once more when it stops
 * being so. `active()` lets the owner veto (a search view moves the camera on purpose).
 */
export function useCameraSave(camera: CameraApi, store: BoardsStore, boardId: string | null, enabled: boolean, active: () => boolean) {
  const storeRef = useRef(store);
  const activeRef = useRef(active);
  useLayoutEffect(() => {
    storeRef.current = store;
    activeRef.current = active;
  });
  useLayoutEffect(() => {
    if (!enabled || !boardId) return;
    let dirty = false;
    let timer = 0;
    const save = () => {
      window.clearTimeout(timer);
      timer = 0;
      if (dirty && activeRef.current()) storeRef.current.setCamera(boardId, { ...camera.get() });
      dirty = false;
    };
    const unsub = camera.subscribe(() => {
      dirty = true;
      window.clearTimeout(timer);
      timer = window.setTimeout(save, SAVE_DEBOUNCE_MS);
    });
    // Layout cleanups run before the next route's camera jump, so this still sees the board's camera.
    return () => {
      unsub();
      save();
    };
  }, [camera, boardId, enabled]);
}
