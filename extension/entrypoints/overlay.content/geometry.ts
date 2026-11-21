// Adapted from Pond (MIT) apps/extension/entrypoints/overlay.content/geometry.ts @ deb305e
export interface Point { x: number; y: number }
export interface Rect { x: number; y: number; width: number; height: number }

export function clampPoint(x: number, y: number, w = innerWidth, h = innerHeight): Point {
  return { x: Math.min(w, Math.max(0, x)), y: Math.min(h, Math.max(0, y)) };
}

export function rectBetween(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

/** Clip to the viewport and drop slivers; the result is what captureVisibleTab can see. */
export function viewportRect(rect: Rect, w = innerWidth, h = innerHeight, dpr = devicePixelRatio) {
  const a = clampPoint(rect.x, rect.y, w, h);
  const b = clampPoint(rect.x + rect.width, rect.y + rect.height, w, h);
  const width = b.x - a.x;
  const height = b.y - a.y;
  if (width < 4 || height < 4) return null;
  return { x: a.x, y: a.y, w: width, h: height, dpr };
}
