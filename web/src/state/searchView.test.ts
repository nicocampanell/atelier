import { describe, expect, it } from 'vitest';
import { layoutResults, placeBeside } from './searchView';
import { REFERENCES } from '../data/references';
import { FRAME_PAD } from '../canvas/surfaceBridge';
import type { BoardItem } from '../types';

const overlaps = (a: BoardItem, b: BoardItem) =>
  a.x - FRAME_PAD < b.x + b.w + FRAME_PAD &&
  a.x + a.w + FRAME_PAD > b.x - FRAME_PAD &&
  a.y - FRAME_PAD < b.y + b.h + FRAME_PAD &&
  a.y + a.h + FRAME_PAD > b.y - FRAME_PAD;

const box = (id: string, x: number, y: number, w = 100, h = 100): BoardItem => ({ id, refId: 'r-sofa', x, y, w, h, z: 1 });

describe('layoutResults', () => {
  it('returns [] for no refs', () => {
    expect(layoutResults([], { x: 0, y: 0 })).toEqual([]);
  });

  it('uses a single column for one ref and fixed card width', () => {
    const [i] = layoutResults(REFERENCES.slice(0, 1), { x: 0, y: 0 });
    expect(i.w).toBe(240);
  });

  it('uses up to 5 columns', () => {
    const items = layoutResults(REFERENCES.slice(0, 20), { x: 0, y: 0 });
    expect(new Set(items.map((i) => i.x)).size).toBe(5);
    expect(items).toHaveLength(20);
  });

  it('centers the cluster on the given point (within rounding)', () => {
    const c = { x: 500, y: -300 };
    const items = layoutResults(REFERENCES.slice(0, 9), c);
    const cx = (Math.min(...items.map((i) => i.x)) + Math.max(...items.map((i) => i.x + i.w))) / 2;
    const cy = (Math.min(...items.map((i) => i.y)) + Math.max(...items.map((i) => i.y + i.h))) / 2;
    expect(Math.abs(cx - c.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - c.y)).toBeLessThanOrEqual(1);
  });

  it('never overlaps frames', () => {
    const items = layoutResults(REFERENCES, { x: 0, y: 0 });
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) expect(overlaps(items[a], items[b])).toBe(false);
  });
});

describe('placeBeside', () => {
  it('returns the same array when nothing overlaps', () => {
    const items = [box('n', 1000, 0)];
    expect(placeBeside(items, [box('b', 0, 0)])).toBe(items);
  });

  it('returns the input for empty board or empty items', () => {
    const items = [box('n', 0, 0)];
    expect(placeBeside(items, [])).toBe(items);
    expect(placeBeside([], [box('b', 0, 0)])).toEqual([]);
  });

  it('shifts right of the board, top-aligned, when overlapping', () => {
    const board = [box('b1', 0, 0), box('b2', 200, 50)];
    const items = [box('n1', 50, 50), box('n2', 150, 150)];
    const out = placeBeside(items, board);
    expect(out).not.toBe(items);
    const boardR = Math.max(...board.map((b) => b.x + b.w)) + FRAME_PAD;
    expect(Math.min(...out.map((i) => i.x - FRAME_PAD))).toBeGreaterThan(boardR);
    expect(Math.min(...out.map((i) => i.y))).toBe(Math.min(...board.map((b) => b.y)));
    for (const o of out) for (const b of board) expect(overlaps(o, b)).toBe(false);
    // relative layout preserved
    expect(out[1].x - out[0].x).toBe(100);
    expect(out[1].y - out[0].y).toBe(100);
  });
});
