import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { BoardItem, Camera } from '../types';

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;

type Point = { x: number; y: number };
type Listener = (camera: Camera) => void;

/** Options for a programmatic camera tween. */
export interface TweenOptions {
  /** Milliseconds. Defaults to 260. */
  duration?: number;
  /** Maps linear progress 0..1 to eased progress 0..1. Defaults to ease-out cubic. */
  easing?: (t: number) => number;
  /** Called when the tween lands (never if something else takes over the camera first). */
  onDone?: () => void;
}

export interface FitOptions {
  minZoom?: number;
  maxZoom?: number;
  /** Also keep the zoom inside [MIN_ZOOM, MAX_ZOOM]. Default true; previews pass false. */
  clamp?: boolean;
}

type Rect = { x: number; y: number; w: number; h: number };

const padFor = (w: number) => Math.min(96, w * 0.1);

function boundsOf(items: Rect[]) {
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const maxY = Math.max(...items.map((i) => i.y + i.h));
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * The camera that centers `items` in a w x h box (pure; this is what "fit to content" means
 * everywhere, including board tile previews). Zoom never exceeds `maxZoom` (default 1).
 */
export function fitCamera(items: Rect[], w: number, h: number, opts: FitOptions = {}): Camera {
  if (!items.length) return { x: w / 2, y: h / 2, zoom: 1 };
  const b = boundsOf(items);
  const pad = padFor(w);
  const fit = Math.min(opts.maxZoom ?? 1, (w - pad * 2) / b.w, (h - pad * 2) / b.h);
  const raw = Math.max(opts.minZoom ?? MIN_ZOOM, fit);
  const zoom = opts.clamp === false ? raw : clampZoom(raw);
  return { x: w / 2 - ((b.minX + b.maxX) / 2) * zoom, y: h / 2 - ((b.minY + b.maxY) / 2) * zoom, zoom };
}

export interface CameraApi {
  frameRef: RefObject<HTMLDivElement | null>;
  worldRef: RefObject<HTMLDivElement | null>;
  /** Live camera object. Read it, never mutate it. */
  get(): Camera;
  subscribe(listener: Listener): () => void;
  screenToWorld(clientX: number, clientY: number): Point;
  /** World point at the center of the visible canvas. */
  center(): Point;
  /** Anchor is in client px; defaults to the frame center. */
  zoomTo(level: number, anchor?: Point): void;
  zoomBy(factor: number, anchor?: Point): void;
  /** Zoom is clamped to [minZoom, maxZoom]; maxZoom defaults to 1 so a fit never exceeds 100%. */
  fitToContent(items: BoardItem[], opts?: { animate?: boolean; minZoom?: number; maxZoom?: number }): void;
  /** `false` (or reduced motion) applies the camera at once. An options object tunes the tween. */
  animateTo(camera: Camera, animate?: boolean | TweenOptions): void;
  /** Applies a camera synchronously (DOM written before returning), cancelling any tween. */
  jump(camera: Camera): void;
  /** Frame padding-box size in px (the space the camera lives in). */
  frameSize(): { w: number; h: number };
  /** True when the items' bounding box does not fit at zoom 1. */
  overflows(items: BoardItem[]): boolean;
}

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** CSS-style cubic-bezier easing, for example cubicBezier(0.65, 0, 0.35, 1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sy = (t: number) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      const v = sx(t);
      if (Math.abs(v - x) < 1e-6) break;
      if (v < x) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return sy(t);
  };
}
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

function createCamera(
  frameRef: RefObject<HTMLDivElement | null>,
  worldRef: RefObject<HTMLDivElement | null>,
): CameraApi & { flush(): void; cancelTween(): void; set(c: Partial<Camera>): void } {
  const cam: Camera = { x: 0, y: 0, zoom: 1 };
  const listeners = new Set<Listener>();
  let raf = 0;
  let tween = 0;

  const flush = () => {
    raf = 0;
    const world = worldRef.current;
    if (world) world.style.transform = `translate3d(${cam.x}px, ${cam.y}px, 0) scale(${cam.zoom})`;
    listeners.forEach((l) => l(cam));
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(flush);
  };
  const cancelTween = () => {
    cancelAnimationFrame(tween);
    tween = 0;
  };

  /** Client px -> frame padding-box px (the space the camera lives in). */
  const toLocal = (p: Point): Point => {
    const f = frameRef.current;
    if (!f) return p;
    const r = f.getBoundingClientRect();
    return { x: p.x - r.left - f.clientLeft, y: p.y - r.top - f.clientTop };
  };
  const size = () => {
    const f = frameRef.current;
    return { w: f?.clientWidth ?? 0, h: f?.clientHeight ?? 0 };
  };
  const localCenter = (): Point => {
    const { w, h } = size();
    return { x: w / 2, y: h / 2 };
  };

  const animateTo = (target: Camera, animate: boolean | TweenOptions = true) => {
    cancelTween();
    const opts: TweenOptions | null = typeof animate === 'object' ? animate : null;
    if (animate === false || reducedMotion()) {
      Object.assign(cam, target);
      schedule();
      opts?.onDone?.();
      return;
    }
    const from = { ...cam };
    const start = performance.now();
    const dur = opts?.duration ?? 260;
    const ease = opts?.easing ?? ((t: number) => 1 - Math.pow(1 - t, 3));
    // Custom tweens zoom geometrically and pan the world point under the frame center, so a
    // zoom into or out of a spot reads as one move. Plain tweens interpolate the raw camera.
    const { w, h } = size();
    const path = opts && w > 0 && from.zoom > 0 && target.zoom > 0;
    const cx = w / 2;
    const cy = h / 2;
    const w0 = { x: (cx - from.x) / from.zoom, y: (cy - from.y) / from.zoom };
    const w1 = { x: (cx - target.x) / target.zoom, y: (cy - target.y) / target.zoom };
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = ease(t);
      if (t >= 1) {
        Object.assign(cam, target);
      } else if (path) {
        const z = from.zoom * Math.pow(target.zoom / from.zoom, e);
        const dz = 1 / target.zoom - 1 / from.zoom;
        const p = Math.abs(dz) < 1e-9 ? e : (1 / z - 1 / from.zoom) / dz;
        cam.zoom = z;
        cam.x = cx - z * (w0.x + (w1.x - w0.x) * p);
        cam.y = cy - z * (w0.y + (w1.y - w0.y) * p);
      } else {
        cam.x = from.x + (target.x - from.x) * e;
        cam.y = from.y + (target.y - from.y) * e;
        cam.zoom = from.zoom + (target.zoom - from.zoom) * e;
      }
      schedule();
      if (t < 1) tween = requestAnimationFrame(step);
      else {
        tween = 0;
        opts?.onDone?.();
      }
    };
    tween = requestAnimationFrame(step);
  };

  /** Camera that puts `zoom` into effect while keeping local point `a` fixed. */
  const zoomedAbout = (zoom: number, a: Point): Camera => {
    const z = clampZoom(zoom);
    const wx = (a.x - cam.x) / cam.zoom;
    const wy = (a.y - cam.y) / cam.zoom;
    return { x: a.x - wx * z, y: a.y - wy * z, zoom: z };
  };

  const bounds = boundsOf;

  return {
    frameRef,
    worldRef,
    flush,
    cancelTween,
    set(c) {
      Object.assign(cam, c);
      schedule();
    },
    jump(c) {
      cancelTween();
      Object.assign(cam, c);
      flush();
    },
    frameSize: size,
    get: () => cam,
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    screenToWorld(cx, cy) {
      const p = toLocal({ x: cx, y: cy });
      return { x: (p.x - cam.x) / cam.zoom, y: (p.y - cam.y) / cam.zoom };
    },
    center() {
      const c = localCenter();
      return { x: (c.x - cam.x) / cam.zoom, y: (c.y - cam.y) / cam.zoom };
    },
    animateTo(c, animate) {
      animateTo({ ...c }, animate);
    },
    zoomTo(level, anchor) {
      animateTo(zoomedAbout(level, anchor ? toLocal(anchor) : localCenter()));
    },
    zoomBy(factor, anchor) {
      animateTo(zoomedAbout(cam.zoom * factor, anchor ? toLocal(anchor) : localCenter()));
    },
    fitToContent(items, opts) {
      const { w, h } = size();
      animateTo(fitCamera(items, w, h, opts), opts?.animate);
    },
    overflows(items) {
      if (!items.length) return false;
      const { w, h } = size();
      const b = bounds(items);
      const pad = padFor(w);
      return b.w > w - pad * 2 || b.h > h - pad * 2;
    },
  };
}

/**
 * Owns the camera. It lives in a ref and is written straight to the world div
 * once per animation frame; React never re-renders for pan or zoom.
 */
export function useCamera(
  opts: {
    onEmptyClick?: (additive: boolean) => void;
    /** True while plain drags on empty canvas belong to the caller (marquee) instead of panning. */
    claimEmptyDrag?: () => boolean;
  } = {},
): CameraApi {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const [api] = useState(() => createCamera(frameRef, worldRef));
  const onEmptyClick = useRef(opts.onEmptyClick);
  const claimEmptyDrag = useRef(opts.claimEmptyDrag);
  useEffect(() => {
    onEmptyClick.current = opts.onEmptyClick;
    claimEmptyDrag.current = opts.claimEmptyDrag;
  });

  // Start with the world origin in the middle of the canvas.
  useLayoutEffect(() => {
    const f = frameRef.current;
    if (f) api.set({ x: f.clientWidth / 2, y: f.clientHeight / 2, zoom: 1 });
    api.flush();
  }, [api]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const cam = api.get();
    let space = false;
    let pan: { id: number; lx: number; ly: number; sx: number; sy: number; moved: boolean; empty: boolean } | null = null;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      api.cancelTween();
      const k = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const dy = Math.max(-40, Math.min(40, e.deltaY * k));
        const z = clampZoom(cam.zoom * Math.exp(-dy * 0.01));
        const r = frame.getBoundingClientRect();
        const ax = e.clientX - r.left - frame.clientLeft;
        const ay = e.clientY - r.top - frame.clientTop;
        const wx = (ax - cam.x) / cam.zoom;
        const wy = (ay - cam.y) / cam.zoom;
        api.set({ x: ax - wx * z, y: ay - wy * z, zoom: z });
      } else {
        api.set({ x: cam.x - e.deltaX * k, y: cam.y - e.deltaY * k });
      }
    };

    const setCursorClass = () => {
      frame.classList.toggle('is-space', space);
      frame.classList.toggle('is-panning', !!pan);
    };

    const startPan = (e: PointerEvent, empty: boolean) => {
      api.cancelTween();
      frame.setPointerCapture(e.pointerId);
      pan = { id: e.pointerId, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, empty };
      setCursorClass();
      e.preventDefault();
    };
    // Capture phase: Space+drag or middle button pans over anything, before blocks see the event.
    const onDownCapture = (e: PointerEvent) => {
      if (pan || (e.target as HTMLElement).closest('[data-chrome]')) return;
      if ((space && e.button === 0) || e.button === 1) {
        e.stopPropagation();
        startPan(e, false);
      }
    };
    // Bubble phase: a plain drag on empty canvas pans (unless claimed); a plain click clears selection.
    const onDownBubble = (e: PointerEvent) => {
      if (pan || e.button !== 0 || claimEmptyDrag.current?.()) return;
      if ((e.target as HTMLElement).closest('[data-chrome],[data-block],[data-tile]')) return;
      startPan(e, true);
    };

    const onMove = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      if (!pan.moved && Math.hypot(e.clientX - pan.sx, e.clientY - pan.sy) < 3) return;
      pan.moved = true;
      api.set({ x: cam.x + e.clientX - pan.lx, y: cam.y + e.clientY - pan.ly });
      pan.lx = e.clientX;
      pan.ly = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      if (!pan || e.pointerId !== pan.id) return;
      const clicked = pan.empty && !pan.moved && e.type === 'pointerup';
      pan = null;
      setCursorClass();
      if (clicked) onEmptyClick.current?.(e.shiftKey);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || isTypingTarget(e.target) || (e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      if (!space) {
        space = true;
        setCursorClass();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      space = false;
      setCursorClass();
    };
    const onBlur = () => {
      space = false;
      setCursorClass();
    };

    frame.addEventListener('wheel', onWheel, { passive: false });
    frame.addEventListener('pointerdown', onDownCapture, true);
    frame.addEventListener('pointerdown', onDownBubble);
    frame.addEventListener('pointermove', onMove);
    frame.addEventListener('pointerup', onUp);
    frame.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      frame.removeEventListener('wheel', onWheel);
      frame.removeEventListener('pointerdown', onDownCapture, true);
      frame.removeEventListener('pointerdown', onDownBubble);
      frame.removeEventListener('pointermove', onMove);
      frame.removeEventListener('pointerup', onUp);
      frame.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [api]);

  return api;
}
