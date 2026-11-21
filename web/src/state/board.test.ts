import { describe, expect, it } from 'vitest';
import { idsInRect, reducer, resizeFromCorner, type BoardState } from './board';
import type { BoardItem } from '../types';
import { linkImageHeight } from '../refs/store';

const item = (id: string, z: number, x = 0, y = 0): BoardItem => ({ id, refId: 'r-sofa', x, y, w: 10, h: 10, z });
const st = (items: BoardItem[], selected: string[] = []): BoardState => ({ items, selected });

describe('board reducer', () => {
  it('add puts the item on top and selects it', () => {
    const s = reducer(st([item('a', 1), item('b', 5)]), { type: 'add', item: { id: 'c', refId: 'r-sofa', x: 1, y: 2, w: 3, h: 4 } });
    expect(s.items.find((i) => i.id === 'c')?.z).toBe(6);
    expect(s.selected).toEqual(['c']);
  });

  it('move shifts only the given ids', () => {
    const s = reducer(st([item('a', 1, 0, 0), item('b', 2, 5, 5)]), { type: 'move', ids: ['a'], dx: 3, dy: -2 });
    expect(s.items[0]).toMatchObject({ x: 3, y: -2 });
    expect(s.items[1]).toMatchObject({ x: 5, y: 5 });
  });

  it('resize changes only the given ids and keeps the selection', () => {
    const s = reducer(st([item('a', 1), item('b', 2)], ['b']), { type: 'resize', sizes: { a: { w: 260, h: 300 } } });
    expect(s.items[0]).toMatchObject({ w: 260, h: 300 });
    expect(s.items[1]).toMatchObject({ w: 10, h: 10 });
    expect(s.selected).toEqual(['b']);
  });

  it('link cards fit their preview image within 140-420 px', () => {
    expect(linkImageHeight(1000, 1000)).toBe(260);
    expect(linkImageHeight(1200, 630)).toBe(140);
    expect(linkImageHeight(500, 2000)).toBe(420);
  });

  it('corner resize keeps the aspect ratio and pins the opposite corner', () => {
    const o = { x: 0, y: 0, w: 200, h: 100 };
    expect(resizeFromCorner(o, 'br', 200, 100)).toEqual({ x: 0, y: 0, w: 400, h: 200 });
    expect(resizeFromCorner(o, 'tl', 100, 50)).toEqual({ x: 100, y: 50, w: 100, h: 50 });
    const tr = resizeFromCorner(o, 'tr', 100, 0);
    expect(tr.w / tr.h).toBeCloseTo(2);
    expect(tr.x).toBe(0);
    expect(tr.y + tr.h).toBeCloseTo(100);
    expect(resizeFromCorner(o, 'br', -1000, -1000)).toMatchObject({ w: 80, h: 40 });
  });

  it('idsInRect returns items overlapping the box, in any drag direction', () => {
    const items = [item('a', 1, 0, 0), item('b', 2, 50, 50)];
    expect(idsInRect(items, { x: 5, y: 5 }, { x: -5, y: -5 })).toEqual(['a']);
    expect(idsInRect(items, { x: 100, y: 100 }, { x: 5, y: 5 })).toEqual(['a', 'b']);
    expect(idsInRect(items, { x: 20, y: 20 }, { x: 40, y: 40 })).toEqual([]);
  });

  it('duplicate skips sub-board cards', () => {
    const card: BoardItem = { id: 'k', refId: '', boardId: 'c', x: 0, y: 0, w: 10, h: 10, z: 2 };
    const s = reducer(st([item('a', 1), card]), { type: 'duplicate', ids: ['a', 'k'], newIds: ['a2', 'k2'] });
    expect(s.items.map((i) => i.id)).toEqual(['a', 'k', 'a2']);
    expect(s.selected).toEqual(['a2']);
  });

  it('remove drops items and prunes the selection', () => {
    const s = reducer(st([item('a', 1), item('b', 2)], ['a', 'b']), { type: 'remove', ids: ['a'] });
    expect(s.items.map((i) => i.id)).toEqual(['b']);
    expect(s.selected).toEqual(['b']);
  });

  it('duplicate offsets copies, stacks them on top in z order and selects them', () => {
    const s = reducer(st([item('a', 2, 10, 10), item('b', 1, 0, 0)]), {
      type: 'duplicate',
      ids: ['a', 'b'],
      newIds: ['a2', 'b2'],
    });
    const b2 = s.items.find((i) => i.id === 'b2')!;
    const a2 = s.items.find((i) => i.id === 'a2')!;
    expect(a2).toMatchObject({ x: 34, y: 34 });
    expect(b2.z).toBe(3);
    expect(a2.z).toBe(4);
    expect(s.selected.sort()).toEqual(['a2', 'b2']);
  });

  it('front restacks above everything, keeping relative order', () => {
    const s = reducer(st([item('a', 1), item('b', 2), item('c', 3)]), { type: 'front', ids: ['a', 'b'] });
    const z = Object.fromEntries(s.items.map((i) => [i.id, i.z]));
    expect(z.c).toBe(3);
    expect(z.a).toBe(4);
    expect(z.b).toBe(5);
  });

  it('front is a no-op when already on top', () => {
    const state = st([item('a', 1), item('b', 2)]);
    expect(reducer(state, { type: 'front', ids: ['b'] })).toBe(state);
  });

  it('select replaces or toggles additively', () => {
    let s = reducer(st([item('a', 1), item('b', 2)], ['a']), { type: 'select', ids: ['b'], additive: false });
    expect(s.selected).toEqual(['b']);
    s = reducer(s, { type: 'select', ids: ['a', 'b'], additive: true });
    expect(s.selected).toEqual(['a']);
  });

  it('append adds on top in current z order and selects', () => {
    const s = reducer(st([item('a', 4)]), { type: 'append', items: [item('y', 20), item('x', 10)] });
    expect(s.items.map((i) => [i.id, i.z])).toEqual([['a', 4], ['x', 5], ['y', 6]]);
    expect(s.selected).toEqual(['x', 'y']);
  });

  it('replace swaps the list and clears the selection', () => {
    const s = reducer(st([item('a', 1)], ['a']), { type: 'replace', items: [item('q', 9)] });
    expect(s.items.map((i) => i.id)).toEqual(['q']);
    expect(s.selected).toEqual([]);
  });
});
