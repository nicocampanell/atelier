import { describe, expect, it } from 'vitest';
import { culled, nextWindow, viewport } from './cull';

const size = { w: 1000, h: 800 };
const at = (id: string, x: number, y = 0) => ({ id, x, y, w: 100, h: 100 });

describe('viewport culling', () => {
  it('maps the camera to a world rect', () => {
    expect(viewport({ x: -200, y: -80, zoom: 2 }, size)).toEqual({ x: 100, y: 40, w: 500, h: 400 });
  });

  it('keeps the window while panning inside the slack and replaces it past that', () => {
    const w0 = nextWindow(null, { x: 0, y: 0, zoom: 1 }, size)!;
    expect(w0).toMatchObject({ x: -1000, w: 3000 }); // one viewport (its longer side) of margin each side
    expect(nextWindow(w0, { x: -500, y: 0, zoom: 1 }, size)).toBe(w0);
    expect(nextWindow(w0, { x: -1900, y: 0, zoom: 1 }, size)).not.toBe(w0);
    expect(nextWindow(w0, { x: 0, y: 0, zoom: 2 }, size)).not.toBe(w0); // zoomed in: window too big
    expect(nextWindow(w0, { x: 0, y: 0, zoom: 0.5 }, size)).not.toBe(w0); // zoomed out: window too small
    expect(nextWindow(w0, { x: 0, y: 0, zoom: 1 }, { w: 0, h: 0 })).toBeNull();
  });

  it('drops off-window items but never the kept ones', () => {
    const win = nextWindow(null, { x: 0, y: 0, zoom: 1 }, size);
    const items = [at('in', 10), at('edge', 1950), at('far', 5000), at('sel', -9000)];
    expect(culled(items, win, new Set(['sel'])).map((i) => i.id)).toEqual(['in', 'edge', 'sel']);
    expect(culled(items, null)).toBe(items);
  });
});
