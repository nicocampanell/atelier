import type { Camera } from '../types';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Size = { w: number; h: number };

/** World rect visible through a `size` frame, grown by `pad` screen px on every side. */
export function viewport(cam: Camera, size: Size, pad = 0): Rect {
  return { x: (-cam.x - pad) / cam.zoom, y: (-cam.y - pad) / cam.zoom, w: (size.w + pad * 2) / cam.zoom, h: (size.h + pad * 2) / cam.zoom };
}

const overlaps = (i: Rect, r: Rect) => i.x < r.x + r.w && i.x + i.w > r.x && i.y < r.y + r.h && i.y + i.h > r.y;
const contains = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/**
 * The world window to render: one viewport of margin on every side. It is only replaced once the
 * viewport (plus a quarter-viewport of slack) leaves it, or a zoom-in makes it needlessly big, so
 * panning re-renders React in coarse steps, not per frame. Returns `cur` itself while it still holds.
 * `null` means the frame has no size yet: render everything.
 */
export function nextWindow(cur: Rect | null, cam: Camera, size: Size): Rect | null {
  if (!size.w || !size.h) return null;
  const pad = Math.max(size.w, size.h);
  const full = viewport(cam, size, pad);
  return cur && contains(cur, viewport(cam, size, pad / 4)) && cur.w <= full.w * 1.34 ? cur : full;
}

/** Items overlapping `win`, plus any id in `keep` (selected, dragged, focused...). Same array when `win` is null. */
export function culled<T extends Rect & { id: string }>(items: T[], win: Rect | null, keep?: ReadonlySet<string>): T[] {
  return win ? items.filter((i) => overlaps(i, win) || keep?.has(i.id)) : items;
}
