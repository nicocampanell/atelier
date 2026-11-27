import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  BOARDS_STORAGE_KEY,
  SUBBOARD_SIZE,
  boardPath,
  LEGACY_STORAGE_KEY,
  boardsContaining,
  boardsReducer,
  removeItemsOfRefFrom,
  restoreItemsTo,
  loadBoards,
  masonryLayout,
  nextTileSlot,
  placeRefInBoard,
  placeRefInMain,
  refsToAutoPlace,
  MAIN_SEEN_KEY,
  saveBoards,
  seedBoards,
  tileSlot,
  uniqueBoardName,
  useBoard,
  useBoards,
  type BoardsState,
} from './boards';
import { BOARD_TILE_H, BOARD_TILE_W, MAIN_ID, type BoardsStore } from './contracts';
import { REFERENCE_BY_ID } from '../data/references';
import type { BoardItem, Reference } from '../types';
import { refsInternal, _resetForTests, newUserId } from '../refs/store';

const store = (data: Record<string, string>) => ({ getItem: (k: string) => (k in data ? data[k] : null) });
const byName = (s: BoardsState, name: string) => s.boards.find((b) => b.name === name)!;
const item = (id: string, x: number, y: number, w = 100, h = 80, z = 1): BoardItem => ({ id, refId: 'r-sofa', x, y, w, h, z });

describe('seeds', () => {
  const s = seedBoards(1000);

  it('has the four boards with expected contents', () => {
    expect(s.boards.map((b) => b.name)).toEqual(['Moodboard', 'Food', 'Interiors', 'Color']);
    expect(s.lastOpenedId).toBeNull();
    const refs = (n: string) => s.items[byName(s, n).id].map((i) => i.refId);
    expect(refs('Moodboard')).toHaveLength(8);
    expect(refs('Food')).toContain('n-food');
    expect(refs('Food').filter((r) => r.startsWith('f-'))).toHaveLength(12);
    expect(refs('Interiors')).toEqual(
      expect.arrayContaining(['r-sofa', 'r-living', 'r-office', 'r-bedroom', 'r-interior-plants', 'r-chair-corner', 'n-light']),
    );
    expect(refs('Color')).toHaveLength(7);
  });

  it('lays tiles on a centered 3-column grid', () => {
    const [a, b, , d] = s.boards;
    expect(b.x - a.x).toBe(BOARD_TILE_W + 64);
    expect(d.x).toBe(a.x);
    expect(d.y - a.y).toBe(BOARD_TILE_H + 64);
    const minX = Math.min(...s.boards.map((t) => t.x));
    const maxX = Math.max(...s.boards.map((t) => t.x + BOARD_TILE_W));
    const minY = Math.min(...s.boards.map((t) => t.y));
    const maxY = Math.max(...s.boards.map((t) => t.y + BOARD_TILE_H));
    expect(Math.abs(minX + maxX)).toBeLessThanOrEqual(1);
    expect(Math.abs(minY + maxY)).toBeLessThanOrEqual(1);
  });

  it('masonry keeps native sizes, leaves 60px between cards and does not overlap', () => {
    const items = masonryLayout(['r-sofa', 'r-living', 'r-office', 'r-bedroom', 'r-interior-plants', 'r-chair-corner', 'n-light']);
    for (const i of items) expect(i).toMatchObject({ w: REFERENCE_BY_ID[i.refId].w, h: REFERENCE_BY_ID[i.refId].h });
    for (let a = 0; a < items.length; a++)
      for (let b = a + 1; b < items.length; b++) {
        const A = items[a],
          B = items[b];
        const gapX = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));
        const gapY = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
        expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(60);
      }
  });
});

describe('loadBoards', () => {
  it('starts empty when storage is empty or missing', () => {
    expect(loadBoards(store({})).boards).toEqual([]);
    expect(loadBoards(null).boards).toEqual([]);
  });

  it('round-trips a saved state', () => {
    const s = seedBoards(5);
    s.lastOpenedId = s.boards[1].id;
    const data: Record<string, string> = {};
    saveBoards({ setItem: (k, v) => void (data[k] = v) }, s);
    expect(loadBoards(store(data))).toEqual(s);
  });

  it('migrates the legacy single board into Moodboard', () => {
    const legacy = [item('a', 1, 2), { ...item('b', 3, 4), refId: 'nope' }];
    const s = loadBoards(store({ [LEGACY_STORAGE_KEY]: JSON.stringify(legacy) }));
    expect(s.boards.map((b) => b.name)).toEqual(['Moodboard']);
    expect(s.items[byName(s, 'Moodboard').id].map((i) => i.id)).toEqual(['a']);
  });

  it('prefers the new key over the legacy one', () => {
    const cur = seedBoards(1);
    const data = { [LEGACY_STORAGE_KEY]: JSON.stringify([item('a', 0, 0)]) } as Record<string, string>;
    saveBoards({ setItem: (k, v) => void (data[k] = v) }, cur);
    expect(loadBoards(store(data))).toEqual(cur);
  });

  it('falls back to empty on corrupt or fully invalid payloads', () => {
    for (const raw of ['{not json', 'null', '42', '{"boards":"x"}', '{"boards":[{"id":"x"}],"items":{}}']) {
      expect(loadBoards(store({ [BOARDS_STORAGE_KEY]: raw })).boards).toEqual([]);
    }
    const throwing = {
      getItem: () => {
        throw new Error('denied');
      },
    };
    expect(loadBoards(throwing).boards).toEqual([]);
  });

  it('drops invalid boards and items with unknown references', () => {
    const good = seedBoards(1).boards[0];
    const raw = JSON.stringify({
      boards: [good, { id: 'bad', name: 'x' }],
      items: { [good.id]: [item('ok', 0, 0), { ...item('ghost', 0, 0), refId: 'does-not-exist' }, { id: 'z' }], bad: [item('q', 0, 0)] },
      lastOpenedId: 'bad',
    });
    const s = loadBoards(store({ [BOARDS_STORAGE_KEY]: raw }));
    expect(s.boards.map((b) => b.id)).toEqual([good.id]);
    expect(s.items[good.id].map((i) => i.id)).toEqual(['ok']);
    expect(s.items.bad).toBeUndefined();
    expect(s.lastOpenedId).toBeNull();
  });

  it('keeps an intentionally empty board list', () => {
    const s = loadBoards(store({ [BOARDS_STORAGE_KEY]: JSON.stringify({ boards: [], items: {}, lastOpenedId: null }) }));
    expect(s.boards).toEqual([]);
  });

  it('saveBoards swallows storage errors', () => {
    expect(() =>
      saveBoards(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        seedBoards(),
      ),
    ).not.toThrow();
  });
});

describe('boardsReducer', () => {
  it('create picks the next free slot and a unique name', () => {
    let s = seedBoards(1);
    s = boardsReducer(s, { type: 'create', id: 'n1', name: '', at: 2 });
    s = boardsReducer(s, { type: 'create', id: 'n2', name: '   ', at: 3 });
    s = boardsReducer(s, { type: 'create', id: 'n3', name: 'Mine', at: 4 });
    expect(s.boards.slice(4).map((b) => b.name)).toEqual(['Untitled board', 'Untitled board 2', 'Mine']);
    expect(s.items.n1).toEqual([]);
    expect(s.boards[4]).toMatchObject(tileSlot(4));
    expect(s.boards[5]).toMatchObject(tileSlot(5));
    expect(s.boards[6]).toMatchObject(tileSlot(6));
    expect(s.boards[4]).toMatchObject({ camera: null, createdAt: 2, updatedAt: 2 });
  });

  it('nextTileSlot skips slots covered by moved tiles and reuses freed ones', () => {
    expect(nextTileSlot([])).toEqual(tileSlot(0));
    const s = seedBoards(1);
    expect(nextTileSlot(s.boards)).toEqual(tileSlot(4));
    const moved = s.boards.map((b, i) => (i === 0 ? { ...b, x: 5000, y: 5000 } : b));
    expect(nextTileSlot(moved)).toEqual(tileSlot(0));
    const overlapping = [{ x: tileSlot(0).x + 10, y: tileSlot(0).y + 10 }];
    expect(nextTileSlot(overlapping)).toEqual(tileSlot(1));
  });

  it('uniqueBoardName increments', () => {
    expect(uniqueBoardName([])).toBe('Untitled board');
    expect(uniqueBoardName([{ name: 'Untitled board' }, { name: 'Untitled board 2' }])).toBe('Untitled board 3');
  });

  it('rename trims and ignores empty', () => {
    const s = seedBoards(1);
    const id = s.boards[0].id;
    expect(boardsReducer(s, { type: 'rename', boardId: id, name: '  New  ' }).boards[0].name).toBe('New');
    expect(boardsReducer(s, { type: 'rename', boardId: id, name: '   ' })).toBe(s);
  });

  it('remove deletes items and clears lastOpenedId only when it was the removed board', () => {
    let s = seedBoards(1);
    const [a, b] = s.boards;
    s = boardsReducer(s, { type: 'markOpened', boardId: a.id });
    expect(boardsReducer(s, { type: 'remove', boardId: b.id }).lastOpenedId).toBe(a.id);
    const r = boardsReducer(s, { type: 'remove', boardId: a.id });
    expect(r.lastOpenedId).toBeNull();
    expect(r.items[a.id]).toBeUndefined();
    expect(r.boards.map((x) => x.id)).not.toContain(a.id);
  });

  it('markOpened ignores unknown boards', () => {
    const s = seedBoards(1);
    expect(boardsReducer(s, { type: 'markOpened', boardId: 'nope' })).toBe(s);
  });

  it('moveTile and setCamera update only that board', () => {
    let s = seedBoards(1);
    const [a, b] = s.boards;
    s = boardsReducer(s, { type: 'moveTile', boardId: a.id, dx: 10, dy: -5 });
    s = boardsReducer(s, { type: 'setCamera', boardId: a.id, camera: { x: 1, y: 2, zoom: 0.5 } });
    expect(s.boards[0]).toMatchObject({ x: a.x + 10, y: a.y - 5, camera: { x: 1, y: 2, zoom: 0.5 } });
    expect(s.boards[1]).toEqual(b);
  });

  it('item actions bump updatedAt and are scoped to the board', () => {
    const s = seedBoards(1);
    const [a, b] = s.boards;
    const target = s.items[a.id][0];
    const n = boardsReducer(s, { type: 'items', boardId: a.id, action: { type: 'move', ids: [target.id], dx: 7, dy: 0 }, at: 99 });
    expect(n.boards[0].updatedAt).toBe(99);
    expect(n.boards[1].updatedAt).toBe(1);
    expect(n.items[a.id][0].x).toBe(target.x + 7);
    expect(n.items[b.id]).toBe(s.items[b.id]);
  });

  it('no-op item actions keep the state identical', () => {
    const s = seedBoards(1);
    expect(boardsReducer(s, { type: 'items', boardId: 'nope', action: { type: 'remove', ids: [] }, at: 5 })).toBe(s);
  });
});

describe('placeRefInBoard', () => {
  const ref = REFERENCE_BY_ID['r-sofa'];

  it('centers on the origin when empty', () => {
    expect(placeRefInBoard([], ref, 'x')).toEqual({ id: 'x', refId: 'r-sofa', x: -ref.w / 2, y: -ref.h / 2, w: ref.w, h: ref.h });
  });

  it('goes 60px right of the content, top-aligned', () => {
    const p = placeRefInBoard([item('a', -50, 10, 100), item('b', 200, -30, 40)], ref, 'x');
    expect(p.x).toBe(240 + 60);
    expect(p.y).toBe(-30);
  });

  it('addRef through the reducer lands on top', () => {
    const s = seedBoards(1);
    const id = s.boards[1].id;
    const it = placeRefInBoard(s.items[id], ref, 'new');
    const n = boardsReducer(s, { type: 'items', boardId: id, action: { type: 'add', item: it }, at: 2 });
    const top = Math.max(...s.items[id].map((i) => i.z));
    expect(n.items[id].find((i) => i.id === 'new')!.z).toBe(top + 1);
  });
});

describe('boardsContaining', () => {
  it('lists boards holding a reference', () => {
    const s = seedBoards(1);
    expect(boardsContaining(s, 'f-pizza').map((b) => b.name)).toEqual(['Food']);
    expect(boardsContaining(s, 'n-light').map((b) => b.name).sort()).toEqual(['Interiors', 'Moodboard']);
    expect(boardsContaining(s, 'nothing')).toEqual([]);
  });
});

describe('useBoards / useBoard (jsdom)', () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  function mount() {
    const out: { store?: BoardsStore; board?: ReturnType<typeof useBoard>; id: string } = { id: '' };
    function Probe() {
      const s = useBoards();
      out.store = s;
      out.board = useBoard(s, out.id || s.boards[0]?.id || MAIN_ID);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    return { out, unmount: () => act(() => root.unmount()) };
  }

  it('starts empty, edits, selects and persists with a debounce', () => {
    localStorage.clear();
    vi.useFakeTimers();
    const { out, unmount } = mount();
    expect(out.store!.boards).toEqual([]);
    act(() => void out.store!.create('First board'));

    const first = out.store!.boards[0].id;
    const before = out.board!.items.length;
    act(() => out.board!.add('r-cat', 0, 0));
    expect(out.board!.items).toHaveLength(before + 1);
    expect(out.board!.selected.size).toBe(1);

    let newId = '';
    act(() => {
      newId = out.store!.create('');
      out.store!.addRef(newId, 'r-cat');
    });
    expect(out.store!.itemsOf(newId)).toHaveLength(1);
    expect(out.store!.boardsContaining('r-cat').map((b) => b.id)).toEqual(expect.arrayContaining([first, newId]));

    // selection resets when the board changes
    out.id = newId;
    act(() => out.board!.select([]));
    expect(out.board!.selected.size).toBe(0);

    expect(localStorage.getItem(BOARDS_STORAGE_KEY)).toBeNull();
    act(() => vi.advanceTimersByTime(300));
    const saved = JSON.parse(localStorage.getItem(BOARDS_STORAGE_KEY)!);
    expect(saved.boards).toHaveLength(2);

    unmount();
    vi.useRealTimers();
  });
});

describe('user references', () => {
  const userRef = () => ({
    id: newUserId(),
    kind: 'note' as const,
    title: 'Mine',
    source: 'Note',
    tags: ['added'],
    color: '#fffdf6',
    body: 'hi',
    w: 240,
    h: 130,
    status: 'ready' as const,
    userAdded: true,
  });

  it('validates stored items of user refs and drops unknown ones', async () => {
    await _resetForTests();
    const r = userRef();
    refsInternal.add(r);
    const s = seedBoards(1);
    const id = s.boards[0].id;
    const items = [
      { id: 'a', refId: r.id, x: 0, y: 0, w: 10, h: 10, z: 1 },
      { id: 'b', refId: 'u-ghost', x: 0, y: 0, w: 10, h: 10, z: 2 },
    ];
    const back = loadBoards(
      store({ [BOARDS_STORAGE_KEY]: JSON.stringify({ boards: [s.boards[0]], items: { [id]: items }, lastOpenedId: null }) }),
    );
    expect(back.items[id].map((i) => i.id)).toEqual(['a']);
  });

  it('masonryLayout accepts user refs', async () => {
    await _resetForTests();
    const r = userRef();
    refsInternal.add(r);
    const out = masonryLayout(['r-sofa', r.id, 'u-ghost']);
    expect(out.map((i) => i.refId)).toEqual(['r-sofa', r.id]);
  });
});

describe('removeItemsOfRef / restoreItems', () => {
  const it2 = (id: string, refId: string, z: number, x = 0): BoardItem => ({ id, refId, x, y: 5, w: 10, h: 10, z });

  function twoBoards() {
    const s = seedBoards(1);
    const [a, b, c] = s.boards;
    return {
      ...s,
      items: {
        [a.id]: [it2('a1', 'r-cat', 1, 1), it2('a2', 'r-sofa', 2), it2('a3', 'r-cat', 3, 3)],
        [b.id]: [it2('b1', 'r-cat', 4, 9), it2('b2', 'r-sofa', 9)],
        [c.id]: [it2('c1', 'r-sofa', 1)],
        [s.boards[3].id]: [],
      },
    } as BoardsState;
  }

  it('removes every block of the reference and reports where they were', () => {
    const s = twoBoards();
    const [a, b, c] = s.boards;
    const { state, removed } = removeItemsOfRefFrom(s, 'r-cat', 99);
    expect(removed.map((e) => [e.boardId, e.item.id])).toEqual([[a.id, 'a1'], [a.id, 'a3'], [b.id, 'b1']]);
    expect(state.items[a.id].map((i) => i.id)).toEqual(['a2']);
    expect(state.items[b.id].map((i) => i.id)).toEqual(['b2']);
    expect(state.items[c.id]).toBe(s.items[c.id]);
    expect(state.boards.find((m) => m.id === a.id)!.updatedAt).toBe(99);
    expect(state.boards.find((m) => m.id === c.id)!.updatedAt).toBe(s.boards[2].updatedAt);
  });

  it('is a no-op when nothing matches', () => {
    const s = twoBoards();
    const r = removeItemsOfRefFrom(s, 'r-nothing', 5);
    expect(r.state).toBe(s);
    expect(r.removed).toEqual([]);
  });

  it('restores with the same ids and coordinates, on top in z order', () => {
    const s = twoBoards();
    const [a, b] = s.boards;
    const { state, removed } = removeItemsOfRefFrom(s, 'r-cat', 10);
    const back = restoreItemsTo(state, removed, 11);
    const onA = back.items[a.id];
    expect(onA.map((i) => i.id)).toEqual(['a2', 'a1', 'a3']);
    expect(onA.find((i) => i.id === 'a1')).toMatchObject({ x: 1, y: 5, w: 10, h: 10 });
    expect(onA.map((i) => i.z)).toEqual([2, 3, 4]);
    expect(back.items[b.id].map((i) => [i.id, i.z])).toEqual([['b2', 9], ['b1', 10]]);
    expect(back.boards.find((m) => m.id === a.id)!.updatedAt).toBe(11);
  });

  it('skips boards that no longer exist and items already present', () => {
    const s = twoBoards();
    const [a, b] = s.boards;
    const { state, removed } = removeItemsOfRefFrom(s, 'r-cat', 10);
    const withoutB = boardsReducer(state, { type: 'remove', boardId: b.id });
    const back = restoreItemsTo(withoutB, removed, 11);
    expect(back.items[b.id]).toBeUndefined();
    expect(back.items[a.id]).toHaveLength(3);
    expect(restoreItemsTo(back, removed, 12)).toBe(back);
  });

  it('works through the store', () => {
    localStorage.clear();
    saveBoards(localStorage, seedBoards(1));
    vi.useFakeTimers();
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const out: { store?: BoardsStore } = {};
    function Probe() {
      out.store = useBoards();
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    const st = () => out.store!;
    const holders = st().boardsContaining('r-sofa');
    expect(holders.length).toBeGreaterThan(0);
    let removed: ReturnType<BoardsStore['removeItemsOfRef']> = [];
    act(() => {
      removed = st().removeItemsOfRef('r-sofa');
    });
    expect(removed.length).toBeGreaterThan(0);
    expect(st().boardsContaining('r-sofa')).toEqual([]);
    act(() => st().restoreItems(removed));
    expect(st().boardsContaining('r-sofa').map((b) => b.id).sort()).toEqual(holders.map((b) => b.id).sort());
    act(() => root.unmount());
    vi.useRealTimers();
  });
});


it('removes only server boards explicitly reconciled as deleted', () => {
  const state = seedBoards(1);
  const [removed, local] = state.boards;
  const next = boardsReducer({ ...state, lastOpenedId: removed.id }, { type: 'serverMerge', boards: [], items: {}, removed: [removed.id] });
  expect(next.boards.some((board) => board.id === removed.id)).toBe(false);
  expect(next.items[removed.id]).toBeUndefined();
  expect(next.boards.some((board) => board.id === local.id)).toBe(true);
  expect(next.lastOpenedId).toBeNull();
});

describe('boards within boards', () => {
  const withChild = () => {
    const s = seedBoards(1);
    const parent = s.boards[0].id;
    const a = boardsReducer(s, { type: 'createChild', id: 'c1', parentId: parent, name: 'Kid', pos: { x: 100, y: 50 }, at: 5 });
    const b = boardsReducer(a, { type: 'createChild', id: 'c2', parentId: 'c1', name: 'Grandkid', pos: { x: 0, y: 0 }, at: 6 });
    return { s, a, b, parent };
  };

  it('createChild adds the child and a card on top of the parent', () => {
    const { s, a, parent } = withChild();
    const top = Math.max(...s.items[parent].map((i) => i.z));
    const card = a.items[parent].at(-1)!;
    expect(card).toMatchObject({ refId: '', boardId: 'c1', x: 100 - SUBBOARD_SIZE.w / 2, y: 50 - SUBBOARD_SIZE.h / 2, w: SUBBOARD_SIZE.w, h: SUBBOARD_SIZE.h, z: top + 1 });
    expect(a.boards.at(-1)).toMatchObject({ id: 'c1', parentId: parent, name: 'Kid', camera: null, createdAt: 5 });
    expect(a.items.c1).toEqual([]);
    expect(boardsReducer(s, { type: 'createChild', id: 'x', parentId: 'nope', name: 'x', pos: { x: 0, y: 0 }, at: 1 })).toBe(s);
  });

  it('children do not take overview slots', () => {
    const { a } = withChild();
    expect(nextTileSlot(a.boards)).toEqual(tileSlot(4));
    expect(boardsReducer(a, { type: 'create', id: 'n', name: '', at: 9 }).boards.at(-1)).toMatchObject(tileSlot(4));
  });

  it('remove cascades to descendants and drops the card on the parent', () => {
    const { b, parent } = withChild();
    const r = boardsReducer(b, { type: 'remove', boardId: 'c1' });
    expect(r.boards.map((x) => x.id)).not.toEqual(expect.arrayContaining(['c1']));
    expect(r.boards.some((x) => x.id === 'c2')).toBe(false);
    expect(r.items.c1).toBeUndefined();
    expect(r.items.c2).toBeUndefined();
    expect(r.items[parent].some((i) => i.boardId)).toBe(false);
    const root = boardsReducer(b, { type: 'remove', boardId: parent });
    expect(root.boards.some((x) => x.id === 'c1' || x.id === 'c2')).toBe(false);
  });

  it('moveItems carries items into a folder, reparents folders and refuses cycles', () => {
    const { b, parent } = withChild();
    const [first, second] = b.items[parent];
    const moved = boardsReducer(b, { type: 'moveItems', boardId: parent, to: 'c1', ids: [first.id, second.id], at: 7 });
    expect(moved.items[parent].map((i) => i.id)).not.toEqual(expect.arrayContaining([first.id]));
    expect(moved.items.c1.map((i) => i.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    const c2card = b.items.c1[0];
    const into = boardsReducer(b, { type: 'moveItems', boardId: 'c1', to: 'c2', ids: [c2card.id], at: 7 });
    expect(into).toBe(b); // a folder cannot enter itself
    const c1card = b.items[parent].find((i) => i.boardId === 'c1')!;
    expect(boardsReducer(b, { type: 'moveItems', boardId: parent, to: 'c2', ids: [c1card.id], at: 7 })).toBe(b); // nor its own descendant
    const root = boardsReducer(boardsReducer(b, { type: 'create', id: 'r2', name: 'Other', at: 8 }), { type: 'createChild', id: 'f', parentId: 'r2', name: 'F', pos: { x: 0, y: 0 }, at: 9 });
    const re = boardsReducer(root, { type: 'moveItems', boardId: parent, to: 'f', ids: [c1card.id], at: 10 });
    expect(re.boards.find((x) => x.id === 'c1')?.parentId).toBe('f');
    expect(re.items.f.some((i) => i.boardId === 'c1')).toBe(true);
  });

  it('a server-side removal takes the nested boards with it and merges keep local cards', () => {
    const { b, parent } = withChild();
    const r = boardsReducer(b, { type: 'serverMerge', boards: [], items: {}, removed: [parent] });
    expect(r.boards.some((x) => x.id === 'c1' || x.id === 'c2')).toBe(false);
    expect(r.items.c2).toBeUndefined();
    const kept = boardsReducer(b, { type: 'serverMerge', boards: [b.boards[1]], items: {}, removed: [] });
    expect(kept.boards.map((x) => x.id)).toEqual(expect.arrayContaining(['c1', 'c2']));
  });

  it('validation keeps a card for an existing board and drops one whose board is missing', () => {
    const { a, parent } = withChild();
    const raw = (items: unknown[]) =>
      JSON.stringify({ boards: a.boards, items: { ...a.items, [parent]: items }, lastOpenedId: null });
    const card = { id: 'k', refId: '', boardId: 'c1', x: 0, y: 0, w: 10, h: 10, z: 1 };
    const ok = loadBoards(store({ [BOARDS_STORAGE_KEY]: raw([item('i', 0, 0), card]) }));
    expect(ok.items[parent].map((i) => i.id)).toEqual(['i', 'k']);
    expect(ok.boards.find((b) => b.id === 'c1')!.parentId).toBe(parent);
    const bad = loadBoards(store({ [BOARDS_STORAGE_KEY]: raw([card, { ...card, id: 'm', boardId: 'gone' }, { ...card, id: 'n', boardId: undefined }]) }));
    expect(bad.items[parent].map((i) => i.id)).toEqual(['k']);
  });

  it('boardPath walks root to board and survives cycles and missing parents', () => {
    const { b } = withChild();
    expect(boardPath(b.boards, 'c2').map((x) => x.id)).toEqual([b.boards[0].id, 'c1', 'c2']);
    expect(boardPath(b.boards, 'nope')).toEqual([]);
    const m = (id: string, parentId?: string) => ({ id, parentId, name: id, x: 0, y: 0, camera: null, createdAt: 0, updatedAt: 0 });
    expect(boardPath([m('a', 'b'), m('b', 'a')], 'a').map((x) => x.id)).toEqual(['b', 'a']);
    expect(boardPath([m('a', 'missing')], 'a').map((x) => x.id)).toEqual(['a']);
  });
});

describe('main area', () => {
  it('seeds an empty main and keeps it out of the boards', () => {
    const s = seedBoards(1);
    expect(s.items[MAIN_ID]).toEqual([]);
    expect(s.boards.some((b) => b.id === MAIN_ID)).toBe(false);
    expect(boardsContaining({ ...s, items: { ...s.items, [MAIN_ID]: [item('m', 0, 0)] } }, 'r-sofa').some((b) => b.id === MAIN_ID)).toBe(false);
  });

  it('persists main items, validates their refs and loads old data without main', () => {
    const s = seedBoards(1);
    s.items[MAIN_ID] = [item('m1', 5, 6)];
    const data: Record<string, string> = {};
    saveBoards({ setItem: (k, v) => void (data[k] = v) }, s);
    expect(loadBoards(store(data)).items[MAIN_ID].map((i) => i.id)).toEqual(['m1']);

    const raw = JSON.stringify({ boards: s.boards, items: { [MAIN_ID]: [item('ok', 0, 0), { ...item('ghost', 0, 0), refId: 'nope' }] }, lastOpenedId: null });
    expect(loadBoards(store({ [BOARDS_STORAGE_KEY]: raw })).items[MAIN_ID].map((i) => i.id)).toEqual(['ok']);

    const old = JSON.stringify({ boards: s.boards, items: {}, lastOpenedId: null });
    expect(loadBoards(store({ [BOARDS_STORAGE_KEY]: old })).items[MAIN_ID]).toEqual([]);
  });

  it('item actions work without a BoardMeta; remove and server merges leave main alone', () => {
    let s = seedBoards(1);
    s = boardsReducer(s, { type: 'items', boardId: MAIN_ID, at: 2, action: { type: 'add', item: { id: 'm1', refId: 'r-cat', x: 0, y: 0, w: 10, h: 10 } } });
    s = boardsReducer(s, { type: 'items', boardId: MAIN_ID, at: 3, action: { type: 'move', ids: ['m1'], dx: 4, dy: 5 } });
    expect(s.items[MAIN_ID][0]).toMatchObject({ x: 4, y: 5 });
    expect(boardsReducer(s, { type: 'remove', boardId: MAIN_ID })).toBe(s);
    expect(boardsReducer(s, { type: 'serverMerge', boards: [], items: {}, removed: [s.boards[0].id] }).items[MAIN_ID]).toBe(s.items[MAIN_ID]);
    const moved = boardsReducer(s, { type: 'moveItems', boardId: MAIN_ID, to: s.boards[0].id, ids: ['m1'], at: 4 });
    expect(moved.items[MAIN_ID]).toEqual([]);
    expect(boardsReducer(moved, { type: 'moveItems', boardId: s.boards[0].id, to: MAIN_ID, ids: ['m1'], at: 5 }).items[MAIN_ID]).toHaveLength(1);
    const undone = boardsReducer(moved, { type: 'moveItems', boardId: s.boards[0].id, to: MAIN_ID, ids: ['m1'], at: 5, pos: { x: 4, y: 5 } });
    expect(undone.items[MAIN_ID][0]).toMatchObject({ x: 4, y: 5 });
  });

  it('removeItemsOfRef and restore cover main', () => {
    const s = { ...seedBoards(1), items: { ...seedBoards(1).items, [MAIN_ID]: [item('m1', 0, 0)] } };
    const { state, removed } = removeItemsOfRefFrom(s, 'r-sofa', 9);
    expect(removed.some((e) => e.boardId === MAIN_ID)).toBe(true);
    expect(state.items[MAIN_ID]).toEqual([]);
    expect(restoreItemsTo(state, removed, 10).items[MAIN_ID].map((i) => i.id)).toEqual(['m1']);
  });

  it('places the first main card right of the tiles, then right of main content', () => {
    const s = seedBoards(1);
    const sofa = REFERENCE_BY_ID['r-sofa'];
    const tilesRight = Math.max(...s.boards.map((b) => b.x + BOARD_TILE_W));
    const first = placeRefInMain([], s.boards, sofa, 'a');
    expect(first.x).toBe(tilesRight + 60);
    expect(placeRefInMain([{ ...first, z: 1 }], s.boards, sofa, 'b').x).toBe(first.x + first.w + 60);
  });

  const ref = (id: string, extra: Partial<Reference> = {}) => ({ id, ...extra }) as Reference;

  it('refsToAutoPlace picks unseen user/server refs that are not placed anywhere', () => {
    const s = seedBoards(1);
    s.items[MAIN_ID] = [{ ...item('m', 0, 0), refId: 'u-inmain' }];
    s.items[s.boards[0].id] = [{ ...item('b', 0, 0), refId: 'u-onboard' }];
    const refs = [
      ref('u-new', { userAdded: true }),
      ref('s-new', { serverId: 'srv' }),
      ref('u-seen', { userAdded: true }),
      ref('u-inmain', { userAdded: true }),
      ref('u-onboard', { userAdded: true }),
      ref('seed'),
    ];
    expect(refsToAutoPlace(refs, s, new Set(['u-seen']))).toEqual(['u-new', 's-new']);
  });

  describe('useBoards (jsdom)', () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const userRef = () => ({ id: newUserId(), kind: 'note' as const, title: 'Mine', source: 'Note', tags: [], color: '#fffdf6', body: 'hi', w: 240, h: 130, status: 'ready' as const, userAdded: true });

    function mount() {
      const out: { store?: BoardsStore; main?: ReturnType<typeof useBoard> } = {};
      function Probe() {
        out.store = useBoards();
        out.main = useBoard(out.store, MAIN_ID);
        return null;
      }
      const root = createRoot(document.createElement('div'));
      act(() => root.render(createElement(Probe)));
      return { out, unmount: () => act(() => root.unmount()) };
    }

    it('useBoard(MAIN_ID) and addRef work; auto-place is forward-only and skips refs already placed', async () => {
      await _resetForTests();
      localStorage.clear();
      vi.useFakeTimers();
      const old = userRef();
      refsInternal.add(old);
      const { out, unmount } = mount();
      act(() => void vi.advanceTimersByTime(10));
      expect(out.store!.itemsOf(MAIN_ID)).toEqual([]); // existing content is not dumped into main
      expect(JSON.parse(localStorage.getItem(MAIN_SEEN_KEY)!)).toContain(old.id);

      const mine = userRef();
      const placed = userRef();
      act(() => {
        refsInternal.add(mine);
        refsInternal.add(placed);
        const boardId = out.store!.create('Mine');
        out.store!.addRef(boardId, placed.id); // placed by the add flow in the same tick
      });
      act(() => void vi.advanceTimersByTime(10));
      expect(out.store!.itemsOf(MAIN_ID).map((i) => i.refId)).toEqual([mine.id]);

      act(() => out.main!.remove(out.store!.itemsOf(MAIN_ID).map((i) => i.id)));
      act(() => void vi.advanceTimersByTime(10));
      expect(out.store!.itemsOf(MAIN_ID)).toEqual([]); // a card deleted from main stays gone

      act(() => out.main!.add('r-cat', 0, 0));
      expect(out.main!.items).toHaveLength(1);
      act(() => void expect(out.store!.addRef(MAIN_ID, 'r-sofa')).toBeTruthy());
      expect(out.store!.itemsOf(MAIN_ID)).toHaveLength(2);
      act(() => out.store!.remove(MAIN_ID));
      expect(out.store!.itemsOf(MAIN_ID)).toHaveLength(2);
      unmount();
      vi.useRealTimers();
    });
  });
});
