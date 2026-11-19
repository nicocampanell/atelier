import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createSurfaceFieldController, type SurfaceFieldProps } from 'surface-field';
import type { BoardItem } from '../types';
import type { CameraApi } from './useCamera';
import { culled, viewport } from './cull';

/** Screen px past the frame edge whose cards still go to the field, so edge dots don't flicker. */
const FIELD_MARGIN = 200;

/** Frame padding and radius in world px (match --frame-pad / --frame-radius). */
export const FRAME_PAD = 14;
/** The field clears exactly the card (no extra margin), with the card's own corner radius. */
const FIELD_PAD = 0;
const FIELD_RADIUS = 14;

/** Field settings (user-provided config); spread onto <SurfaceField>. */
export const FIELD_PROPS: SurfaceFieldProps = {
  gap: 21,
  focusRadius: 220,
  lineRadius: 170,
  baseOpacity: 0.02,
  maxOpacity: 0.19,
  connected: true,
  cursorPush: 2,
  ripplePush: 4,
  rippleBoost: 0.07,
  rippleGrow: 0.15,
  rippleSpeed: 1.1,
  tint: 0,
  breathe: 0,
  breatheRate: 1,
  wander: false,
  still: false,
};

/** Scale screen-space effects after zoom settles; gap is scaled by Surface Field. */
export function fieldScale(zoom: number): number {
  return Math.round(Math.max(0.5, Math.min(2.5, zoom)) * 20) / 20;
}

export function scaledFieldProps(zoom: number): SurfaceFieldProps {
  const scale = fieldScale(zoom);
  return {
    ...FIELD_PROPS,
    focusRadius: 220 * scale,
    lineRadius: 170 * scale,
    cursorPush: 2 * scale,
    ripplePush: 4 * scale,
    rippleWidth: 38 * scale,
    surfacePadding: -30 * scale,
    cursorPushRadius: 110 * scale,
  };
}

type Origin = Pick<BoardItem, 'id' | 'x' | 'y' | 'w' | 'h'>;

/**
 * Feeds the camera and block rectangles to Surface Field without re-rendering.
 * Scene rects are screen px relative to the frame's border box.
 */
export function useSurfaceBridge(
  frameRef: RefObject<HTMLDivElement | null>,
  camera: CameraApi,
  items: BoardItem[],
  dragging: boolean,
) {
  const controller = useMemo(createSurfaceFieldController, []);
  const [scale, setScale] = useState(() => fieldScale(camera.get().zoom));
  const fieldProps = useMemo(() => scaledFieldProps(scale), [scale]);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = camera.subscribe(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => setScale(fieldScale(camera.get().zoom)), 160);
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [camera]);
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  });

  const publish = useCallback(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const cam = camera.get();
    controller.setViewport({ x: cam.x, y: cam.y, zoom: cam.zoom });
    const ox = frame.clientLeft + cam.x;
    const oy = frame.clientTop + cam.y;
    const size = camera.frameSize();
    controller.setScene({
      root: frame,
      rects: culled(itemsRef.current, size.w ? viewport(cam, size, FIELD_MARGIN) : null).map((i) => ({
        id: i.id,
        parent: null,
        left: (i.x - FIELD_PAD) * cam.zoom + ox,
        top: (i.y - FIELD_PAD) * cam.zoom + oy,
        right: (i.x + i.w + FIELD_PAD) * cam.zoom + ox,
        bottom: (i.y + i.h + FIELD_PAD) * cam.zoom + oy,
        radius: FIELD_RADIUS * cam.zoom,
      })),
    });
  }, [controller, camera, frameRef]);

  useEffect(() => camera.subscribe(publish), [camera, publish]);

  // Committed scene. While a drag is live the footprint owns the geometry.
  useEffect(() => {
    if (!dragging) publish();
  }, [items, dragging, publish]);

  // Dot color follows the OS theme; the field only watches the root's class.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const refresh = () => controller.refreshTheme();
    mq.addEventListener('change', refresh);
    return () => mq.removeEventListener('change', refresh);
  }, [controller]);

  /** Carried light for a drag: `origin` blocks translated by (tx, ty) world px. */
  const carry = useCallback(
    (pointerId: number, origin: Origin[], tx: number, ty: number) => {
      const frame = frameRef.current;
      if (!frame) return;
      const r = frame.getBoundingClientRect();
      const cam = camera.get();
      const ox = r.left + frame.clientLeft + cam.x;
      const oy = r.top + frame.clientTop + cam.y;
      controller.setFootprint({
        pointerId,
        ids: origin.map((o) => o.id),
        rects: origin.map((o) => ({
          id: o.id,
          left: (o.x + tx - FIELD_PAD) * cam.zoom + ox,
          top: (o.y + ty - FIELD_PAD) * cam.zoom + oy,
          right: (o.x + tx + o.w + FIELD_PAD) * cam.zoom + ox,
          bottom: (o.y + ty + o.h + FIELD_PAD) * cam.zoom + oy,
          radius: FIELD_RADIUS * cam.zoom,
        })),
      });
    },
    [controller, camera, frameRef],
  );

  return { controller, carry, fieldProps };
}
