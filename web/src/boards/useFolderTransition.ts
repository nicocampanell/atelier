import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Camera } from '../types';
import type { BoardsStore } from '../state/contracts';
import type { Route } from '../state/route';
import { fitCamera, type CameraApi } from '../canvas/useCamera';
import { EASE_IN_OUT, ENTER_MS, FADE_MS } from './useBoardTransitions';

interface Options {
  camera: CameraApi;
  store: BoardsStore;
  route: Route;
  setRoute(next: Route): void;
}

/** A camera that makes the folder card fill most of the frame. */
function onCard(card: { x: number; y: number; w: number; h: number }, w: number, h: number): Camera {
  const zoom = Math.min((w * 0.85) / card.w, (h * 0.85) / card.h);
  return { zoom, x: w / 2 - (card.x + card.w / 2) * zoom, y: h / 2 - (card.y + card.h / 2) * zoom };
}

/**
 * Going into and out of a sub-board. In: zoom the camera onto the folder card, then swap to the
 * child's board. Out: swap to the parent already zoomed on the folder card, then zoom back out.
 * While it runs, `busy` locks input and `fade` drives the board layer's crossfade.
 */
export function useFolderTransition(o: Options) {
  const [busy, setBusy] = useState(false);
  const [fade, setFade] = useState<'in' | 'out' | null>(null);
  const busyRef = useRef(false);
  const latest = useRef(o);
  const pending = useRef<{ parentId: string; childId: string } | null>(null);
  const timers = useRef(new Set<number>());
  const guard = useRef(0);

  useLayoutEffect(() => {
    latest.current = o;
  });
  useEffect(() => {
    const set = timers.current;
    return () => {
      set.forEach((id) => window.clearTimeout(id));
      window.clearTimeout(guard.current);
    };
  }, []);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  const end = useCallback(() => {
    window.clearTimeout(guard.current);
    pending.current = null;
    busyRef.current = false;
    setBusy(false);
    setFade(null);
  }, []);
  const begin = useCallback(() => {
    busyRef.current = true;
    setBusy(true);
    // A route change that never arrives must not leave input locked.
    guard.current = window.setTimeout(end, ENTER_MS + FADE_MS + 800);
  }, [end]);

  const dive = useCallback(
    (childId: string): boolean => {
      const { store, route, camera, setRoute } = latest.current;
      if (busyRef.current || route.name !== 'board') return false;
      const card = store.itemsOf(route.id).find((i) => i.boardId === childId);
      const { w } = camera.frameSize();
      if (!card || !w) {
        setRoute({ name: 'board', id: childId });
        return true;
      }
      store.setCamera(route.id, { ...camera.get() });
      begin();
      const { h } = camera.frameSize();
      camera.animateTo(onCard(card, w, h), {
        duration: ENTER_MS,
        easing: EASE_IN_OUT,
        onDone: () => {
          // The route effect seats the child's own camera in the same commit.
          setRoute({ name: 'board', id: childId });
          setFade('in');
          later(FADE_MS + 20, end);
        },
      });
      return true;
    },
    [begin, end, later],
  );

  const rise = useCallback((): boolean => {
    const { store, route, camera } = latest.current;
    if (busyRef.current || route.name !== 'board') return false;
    const parentId = store.boards.find((b) => b.id === route.id)?.parentId;
    if (!parentId) return false;
    store.setCamera(route.id, { ...camera.get() });
    pending.current = { parentId, childId: route.id };
    begin();
    setFade('out');
    later(FADE_MS, () => latest.current.setRoute({ name: 'board', id: parentId }));
    return true;
  }, [begin, later]);

  const routeKey = o.route.name === 'board' ? o.route.id : '';
  useLayoutEffect(() => {
    const p = pending.current;
    const { store, camera } = latest.current;
    if (!p || routeKey !== p.parentId) return;
    pending.current = null;
    const { w, h } = camera.frameSize();
    const card = store.itemsOf(p.parentId).find((i) => i.boardId === p.childId);
    if (!card || !w) return end();
    const rest = store.boards.find((b) => b.id === p.parentId)?.camera ?? fitCamera(store.itemsOf(p.parentId), w, h, { maxZoom: 1 });
    camera.jump(onCard(card, w, h));
    setFade('in');
    camera.animateTo(rest, { duration: ENTER_MS, easing: EASE_IN_OUT, onDone: end });
  }, [routeKey, end]);

  return { busy, fade, dive, rise };
}
