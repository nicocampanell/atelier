import { describe, expect, it } from 'vitest';
import { focusOrder } from './focusOrder';
import type { BoardItem } from '../types';

const item = (id: string, x: number, y: number, h = 100, boardId?: string): BoardItem => ({ id, refId: 'r-sofa', boardId, x, y, w: 100, h, z: 1 });
const ids = (items: BoardItem[]) => focusOrder(items).map((i) => i.id);

describe('focusOrder', () => {
  it('reads rows top to bottom, left to right', () => {
    expect(ids([item('d', 300, 200), item('b', 200, 0), item('c', 0, 210), item('a', 0, 5)])).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps a row together when tops differ but spans overlap', () => {
    expect(ids([item('b', 150, 0), item('a', 0, 60), item('c', 0, 300)])).toEqual(['a', 'b', 'c']);
  });

  it('excludes sub-board cards', () => {
    expect(ids([item('a', 0, 0), item('board', 120, 0, 100, 'b1')])).toEqual(['a']);
  });
});
