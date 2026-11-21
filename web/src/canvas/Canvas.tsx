import { useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { SurfaceField } from 'surface-field';
import { REF_DRAG_MIME } from '../types';
import { refsStore } from '../refs/store';
import { useFileDrop } from '../add/useFileDrop';
import { idsInRect, resizeFromCorner, type Board, type Corner } from '../state/board';
import { FocusView } from './FocusView';
import type { BoardItem } from '../types';
import { BoardsOverview, type OverviewProps } from '../boards/BoardsOverview';
import { Block, type BlockHandlers } from './Block';
import { ResultsBar } from './ResultsBar';
import type { LeavingItem, SearchView } from '../state/searchView';
import { SelectionMenu } from './SelectionMenu';
import { useSurfaceBridge } from './surfaceBridge';
import { isTypingTarget, type CameraApi } from './useCamera';
import { culled, nextWindow, type Rect } from './cull';
import '../boards/boards.css';
import './canvas.css';

const DRAG_THRESHOLD = 3;
const NUDGE = 8;
const NUDGE_BIG = 32;

interface Drag {
  pointerId: number;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  started: boolean;
  ids: string[];
  origin: { id: string; x: number; y: number; w: number; h: number }[];
  tx: number;
  ty: number;
  /** A plain click on one of several selected blocks collapses the selection to it. */
  collapseTo: string | null;
  /** Dragging a corner handle resizes origin[0] instead of moving. */
  corner?: Corner;
  /** The block was already the only selection when pressed: releasing without a drag opens it. */
  open?: boolean;
}

type Point = { x: number; y: number };

export interface SearchLayer {
  /** Temporary result items; selection, drag, delete and duplicate act on these while a view is active. */
  board: Board;
  view: SearchView | null;
  /** Result blocks that are animating out. */
  leaving: LeavingItem[];
  onKeep(): void;
  /** Add just these results to the board. */
  onKeepItems(ids: string[]): void;
  onDone(): void;
}

interface Props {
  board: Board;
  /** The boards overview's own cards (the main area). */
  main: Board;
  camera: CameraApi;
  search: SearchLayer;
  /** Render the board's blocks (route 'board', or mid-transition). */
  showBoard: boolean;
  /** Cross-fade of the block layer during the swap. */
  boardFade: 'in' | 'out' | null;
  /** Render the boards overview tiles; null when they are not on screen. */
  overview: Omit<OverviewProps, 'camera' | 'carry' | 'onDragging'> | null;
  /** The overview tiles as Surface Field rects (cards; the bridge adds the frame padding). */
  tileItems: BoardItem[];
  /** A transition is running: the frame takes no input. */
  busy: boolean;
  /** Another page (library) covers the frame. */
  covered: boolean;
  /** Floating chrome pinned to the frame (the bottom board bar). */
  bottom?: ReactNode;
  /** Files dropped from Finder: `at` is the world point on a board, null on the overview (library). */
  onFiles(files: File[], at: { x: number; y: number } | null): void;
  /** Item whose note is being edited inline. */
  editingItemId: string | null;
  onEditNote(itemId: string): void;
  onEditDone(): void;
  /** Delete user references from the library (and every board). */
  onDeleteRefs(refIds: string[]): void;
  /** Right-click on a board: offer the add menu at `client`, adding at `world`. */
  onAddAt(client: Point, world: Point): void;
  /** Name and items of a nested board, for its card. */
  subBoard(boardId: string): { name: string; items: BoardItem[] } | undefined;
  onEnterBoard(boardId: string): void;
  /** Delete nested boards whose cards were deleted (the store also drops the cards). */
  onRemoveBoards(boardIds: string[]): void;
  /** Items were dropped onto a sub-board card; `from` is their top-left before the drag. */
  onMoveToBoard(itemIds: string[], boardId: string, from: { x: number; y: number }): void;
}

const NO_ITEMS: BoardItem[] = [];

const NOOP_HANDLERS: BlockHandlers = {
  onPointerDown() {},
  onPointerMove() {},
  onPointerUp() {},
  onKeyDown() {},
  onDoubleClick() {},
};

const hasRef = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(REF_DRAG_MIME);

/** Zoomed past this, blocks swap their thumbnail for the full-size image. */
const HI_RES_ZOOM = 1.5;
/** Zoomed out past this (cards are a few dozen px), image blocks become plain color boxes. */
const LOW_ZOOM = 0.3;
/** The frame is fixed inset 0, so the window size stands in until it has one. */
const sizeOf = (camera: CameraApi) => {
  const s = camera.frameSize();
  return s.w ? s : { w: window.innerWidth, h: window.innerHeight };
};
const detailOf = (zoom: number) => (zoom > HI_RES_ZOOM ? 2 : zoom < LOW_ZOOM ? 0 : 1);

export function Canvas({
  board: baseBoard,
  main,
  camera,
  search,
  showBoard,
  boardFade,
  overview,
  tileItems,
  busy,
  covered,
  bottom,
  onFiles,
  editingItemId,
  onEditNote,
  onEditDone,
  onDeleteRefs,
  onAddAt,
  subBoard,
  onEnterBoard,
  onRemoveBoards,
  onMoveToBoard,
}: Props) {
  const searchActive = search.view !== null;
  // While a search view is active, every interaction targets the temp items.
  const board = searchActive ? search.board : showBoard ? baseBoard : main;
  const { frameRef, worldRef } = camera;
  const [dragging, setDragging] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const overviewItems = useMemo(() => [...tileItems, ...main.items], [tileItems, main.items]);
  const fieldItems = showBoard ? board.items : overview ? overviewItems : NO_ITEMS;
  const { controller, carry, fieldProps } = useSurfaceBridge(frameRef, camera, fieldItems, dragging);
  const boardActive = (showBoard || !!overview) && !busy;
  const boardActiveRef = useRef(boardActive);
  useLayoutEffect(() => {
    boardActiveRef.current = boardActive;
  });

  const boardRef = useRef(board);
  /** What a dragged selection can drop into: folder cards, plus the board tiles on the overview. */
  const dropTargets = useRef<BoardItem[]>([]);
  useLayoutEffect(() => {
    boardRef.current = board;
    dropTargets.current = board === main ? [...main.items, ...tileItems.map((t) => ({ ...t, boardId: t.id, z: -1 }))] : board.items;
  });
  const baseBoardRef = useRef(baseBoard);
  useLayoutEffect(() => {
    baseBoardRef.current = baseBoard;
  });
  const drag = useRef<Drag | null>(null);
  const [focus, setFocus] = useState<{ id: string; origin: DOMRect; items: BoardItem[] } | null>(null);
  const enterBoardRef = useRef(onEnterBoard);
  const moveToBoardRef = useRef(onMoveToBoard);
  useEffect(() => {
    enterBoardRef.current = onEnterBoard;
    moveToBoardRef.current = onMoveToBoard;
  });
  /** The folder card under a dragged selection ('over'), or one that just took it in ('received'). */
  const [folder, setFolder] = useState<{ id: string; state: 'over' | 'received' } | null>(null);
  const overRef = useRef<string | null>(null);
  const receivedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(receivedTimer.current), []);
  const setOver = (id: string | null) => {
    if (overRef.current === id) return;
    overRef.current = id;
    setFolder(id ? { id, state: 'over' } : null);
  };
  /** A plain click: sub-board cards open their board, everything else opens the focus view. */
  const open = (el: HTMLElement, id: string) => {
    const item = boardRef.current.items.find((i) => i.id === id);
    if (!item) return;
    if (item.boardId) return enterBoardRef.current(item.boardId);
    const ref = refsStore.get(item.refId);
    if (ref?.kind === 'note' && ref.userAdded) return; // double-click edits it instead
    setFocus({ id, items: boardRef.current.items, origin: (el.querySelector('.block__card') ?? el).getBoundingClientRect() });
  };
  const removeItems = (ids: string[]) => {
    const set = new Set(ids);
    const hit = boardRef.current.items.filter((i) => set.has(i.id));
    const plain = hit.filter((i) => !i.boardId).map((i) => i.id);
    if (plain.length) boardRef.current.remove(plain);
    const boards = hit.flatMap((i) => (i.boardId ? [i.boardId] : []));
    if (boards.length) onRemoveBoards(boards);
  };
  const removeRef = useRef(removeItems);
  useEffect(() => {
    removeRef.current = removeItems;
  });
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  const editNoteRef = useRef(onEditNote);
  useLayoutEffect(() => {
    editNoteRef.current = onEditNote;
  });

  /** 0 = plain color boxes, 1 = thumbnails, 2 = full-size images. */
  const [detail, setDetail] = useState(() => detailOf(camera.get().zoom));
  const hiRes = detail === 2;
  const lowDetail = detail === 0;

  /* ---------- Viewport culling ---------- */
  // Only blocks inside `win` (one viewport of margin) are mounted. `win` is replaced in coarse steps, so
  // panning does not re-render React per frame. Selection, marquee, FocusView and undo work on item data, not DOM.
  const [win, setWin] = useState<Rect | null>(() => nextWindow(null, camera.get(), { w: window.innerWidth, h: window.innerHeight }));
  const [focusedId, setFocusedId] = useState<string | null>(null);
  useLayoutEffect(() => {
    const sync = () => {
      setDetail(detailOf(camera.get().zoom));
      setWin((w) => nextWindow(w, camera.get(), sizeOf(camera)));
    };
    sync();
    window.addEventListener('resize', sync);
    const off = camera.subscribe(sync);
    return () => {
      window.removeEventListener('resize', sync);
      off();
    };
  }, [camera]);

  /* ---------- Block gestures ---------- */
  const handlers = useRef<BlockHandlers>({
    onPointerDown(e, id) {
      if (e.button !== 0) return;
      e.stopPropagation();
      const b = boardRef.current;
      const corner = (e.target as HTMLElement).dataset.corner as Corner | undefined;
      const item = corner && b.items.find((i) => i.id === id);
      if (item) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const { x, y, w, h } = item;
        drag.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, started: false, ids: [id], origin: [{ id, x, y, w, h }], tx: 0, ty: 0, collapseTo: null, corner };
        return;
      }
      const selected = b.selected.has(id);
      let ids: string[];
      let collapseTo: string | null = null;
      if (e.shiftKey) {
        b.select([id], true);
        if (selected) return; // toggled off: nothing to drag
        ids = [...b.selected, id];
      } else if (selected) {
        ids = [...b.selected];
        if (ids.length > 1) collapseTo = id;
      } else {
        b.select([id], false);
        ids = [id];
      }
      b.bringToFront(ids);
      e.currentTarget.setPointerCapture(e.pointerId);
      const set = new Set(ids);
      drag.current = {
        pointerId: e.pointerId,
        sx: e.clientX,
        sy: e.clientY,
        lx: e.clientX,
        ly: e.clientY,
        started: false,
        ids,
        origin: b.items.filter((i) => set.has(i.id)).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })),
        tx: 0,
        ty: 0,
        collapseTo,
        open: selected && b.selected.size === 1,
      };
    },
    onPointerMove(e) {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      if (!e.buttons) {
        // The release was missed (left the window, lost capture): end the gesture instead of following the cursor.
        drag.current = null;
        if (d.started && !d.corner) {
          setDragging(false);
          setOver(null);
        }
        return;
      }
      if (!d.started) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
        d.started = true;
        if (!d.corner) setDragging(true);
      }
      const z = camera.get().zoom;
      if (d.corner) {
        const o = d.origin[0];
        boardRef.current.resize({ [o.id]: resizeFromCorner(o, d.corner, (e.clientX - d.sx) / z, (e.clientY - d.sy) / z) });
        return;
      }
      const dx = (e.clientX - d.lx) / z;
      const dy = (e.clientY - d.ly) / z;
      d.lx = e.clientX;
      d.ly = e.clientY;
      d.tx += dx;
      d.ty += dy;
      boardRef.current.move(d.ids, dx, dy);
      carry(d.pointerId, d.origin, d.tx, d.ty);
      const p = camera.screenToWorld(e.clientX, e.clientY);
      const under = dropTargets.current
        .filter((i) => i.boardId && !d.ids.includes(i.id) && p.x >= i.x && p.x <= i.x + i.w && p.y >= i.y && p.y <= i.y + i.h)
        .sort((a, b) => b.z - a.z)[0];
      setOver(under?.id ?? null);
    },
    onPointerUp(e, id) {
      const d = drag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      drag.current = null;
      if (d.corner) return;
      if (d.started) {
        setDragging(false);
        const target = dropTargets.current.find((i) => i.id === overRef.current);
        if (target?.boardId && e.type === 'pointerup') {
          moveToBoardRef.current(d.ids, target.boardId, { x: Math.min(...d.origin.map((o) => o.x)), y: Math.min(...d.origin.map((o) => o.y)) });
          overRef.current = null;
          setFolder({ id: target.id, state: 'received' });
          window.clearTimeout(receivedTimer.current);
          receivedTimer.current = window.setTimeout(() => setFolder(null), 450);
        } else setOver(null);
      } else if (e.type === 'pointerup' && !e.shiftKey) {
        if (d.collapseTo === id) boardRef.current.select([id], false);
        else if (d.open) openRef.current(e.currentTarget, id);
      }
    },
    onKeyDown(e: KeyboardEvent<HTMLElement>, id) {
      const k = e.key;
      if (k === 'Enter' && e.target === e.currentTarget) {
        e.preventDefault();
        openRef.current(e.currentTarget, id);
        return;
      }
      const dir = k === 'ArrowLeft' ? [-1, 0] : k === 'ArrowRight' ? [1, 0] : k === 'ArrowUp' ? [0, -1] : k === 'ArrowDown' ? [0, 1] : null;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      const b = boardRef.current;
      const step = e.shiftKey ? NUDGE_BIG : NUDGE;
      if (!b.selected.has(id)) b.select([id], false);
      b.move(b.selected.has(id) ? [...b.selected] : [id], dir[0] * step, dir[1] * step);
    },
    onDoubleClick(e: MouseEvent<HTMLElement>, id) {
      const item = boardRef.current.items.find((i) => i.id === id);
      const ref = item && refsStore.get(item.refId);
      // Only notes the user wrote are editable; seed notes are not.
      if (ref?.kind !== 'note' || !ref.userAdded) return;
      e.stopPropagation();
      editNoteRef.current(id);
    },
  }).current;

  /* ---------- Global keys ---------- */
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (isTypingTarget(e.target) || !boardActiveRef.current || document.querySelector('[aria-modal="true"]')) return;
      const b = boardRef.current;
      if ((e.key === 'Delete' || e.key === 'Backspace') && b.selected.size) {
        e.preventDefault();
        removeRef.current([...b.selected]);
      } else if (e.key === 'Escape' && b.selected.size) {
        b.select([], false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ---------- Drop from search ---------- */
  const onDragOver = (e: DragEvent) => {
    if (!boardActiveRef.current || !hasRef(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropActive(false);
  };
  const onDrop = (e: DragEvent) => {
    setDropActive(false);
    if (!boardActiveRef.current || !hasRef(e)) return;
    e.preventDefault();
    const id = e.dataTransfer.getData(REF_DRAG_MIME);
    if (!refsStore.has(id)) return;
    const p = camera.screenToWorld(e.clientX, e.clientY);
    board.add(id, p.x, p.y);
  };

  /* ---------- Drop files from Finder ---------- */
  // Over a board tile the tile takes the files; anywhere else on the overview they go to the library.
  const overTile = (e: DragEvent) => !!(e.target as HTMLElement | null)?.closest?.('[data-tile]:not(.tile--new)');
  const fileDrop = useFileDrop({
    accept: (e) => boardActiveRef.current && !overTile(e),
    onFiles: (files, e) => onFiles(files, camera.screenToWorld(e.clientX, e.clientY)),
  });

  /* ---------- Marquee: drag on empty board canvas selects (useCamera leaves these drags to us) ---------- */
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marquee = useRef<{ id: number; sx: number; sy: number; base: string[]; moved: boolean } | null>(null);
  const onFrameDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!boardActiveRef.current || e.button !== 0 || (e.target as HTMLElement).closest('[data-chrome],[data-block],[data-tile]')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    marquee.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, base: e.shiftKey ? [...boardRef.current.selected] : [], moved: false };
  };
  const onFrameMove = (e: PointerEvent<HTMLDivElement>) => {
    const m = marquee.current;
    if (!m || m.id !== e.pointerId) return;
    if (!e.buttons) {
      marquee.current = null;
      setBox(null);
      return;
    }
    if (!m.moved && Math.hypot(e.clientX - m.sx, e.clientY - m.sy) < DRAG_THRESHOLD) return;
    m.moved = true;
    const f = e.currentTarget;
    const r = f.getBoundingClientRect();
    setBox({ x: Math.min(m.sx, e.clientX) - r.left - f.clientLeft, y: Math.min(m.sy, e.clientY) - r.top - f.clientTop, w: Math.abs(e.clientX - m.sx), h: Math.abs(e.clientY - m.sy) });
    const hits = idsInRect(boardRef.current.items, camera.screenToWorld(m.sx, m.sy), camera.screenToWorld(e.clientX, e.clientY));
    boardRef.current.select([...new Set([...m.base, ...hits])], false);
  };
  const onFrameUp = (e: PointerEvent<HTMLDivElement>) => {
    const m = marquee.current;
    if (!m || m.id !== e.pointerId) return;
    marquee.current = null;
    setBox(null);
    if (!m.moved && !e.shiftKey && e.type === 'pointerup') boardRef.current.select([], false);
  };
  const onContextMenu = (e: MouseEvent<HTMLDivElement>) => {
    if (!boardActiveRef.current || (e.target as HTMLElement).closest('[data-chrome],[data-tile]')) return;
    e.preventDefault();
    onAddAt({ x: e.clientX, y: e.clientY }, camera.screenToWorld(e.clientX, e.clientY));
  };

  // Always mounted, wherever the camera is: selected (so drag and resize), focused, being edited, folder drop target.
  const keep = new Set<string>([...main.selected, ...baseBoard.selected, ...search.board.selected, focusedId, focus?.id, editingItemId, folder?.id].filter((id) => id != null));

  const selectedItems = board.items.filter((i) => board.selected.has(i.id));
  const userRefIds = [...new Set(selectedItems.filter((i) => refsStore.get(i.refId)?.userAdded).map((i) => i.refId))];

  return (
    <div
      ref={frameRef}
      className={['canvas-frame', (dropActive || fileDrop.active) && 'is-drop', busy && 'is-busy', covered && 'is-covered'].filter(Boolean).join(' ')}
      inert={covered || undefined}
      onPointerDown={onFrameDown}
      onPointerMove={onFrameMove}
      onPointerUp={onFrameUp}
      onPointerCancel={onFrameUp}
      onContextMenu={onContextMenu}
      onDragEnter={(e) => {
        onDragOver(e);
        fileDrop.handlers.onDragEnter(e);
      }}
      onDragOver={(e) => {
        onDragOver(e);
        fileDrop.handlers.onDragOver(e);
      }}
      onDragLeave={(e) => {
        onDragLeave(e);
        fileDrop.handlers.onDragLeave(e);
      }}
      onDrop={(e) => {
        onDrop(e);
        fileDrop.handlers.onDrop(e);
      }}
    >
      <SurfaceField
        {...fieldProps}
        controller={controller}
        interactionRoot={frameRef}
        style={{ position: 'absolute', inset: 0, color: 'var(--field-color)' }}
      />
      <div
        ref={worldRef}
        className={search.view?.settling ? 'canvas-world is-settling' : 'canvas-world'}
        onFocus={(e) => setFocusedId((e.target as HTMLElement).closest<HTMLElement>('[data-block]')?.dataset.block ?? null)}
        onBlur={() => setFocusedId(null)}
      >
        {overview && (
          <BoardsOverview {...overview} camera={camera} carry={carry} onDragging={setDragging} drop={folder}>
            {culled(main.items, win, keep).map((item) => (
              <Block
                key={item.id}
                item={item}
                selected={main.selected.has(item.id)}
                dragging={dragging}
                hiRes={hiRes}
                lowDetail={lowDetail}
                editing={editingItemId === item.id}
                onEditDone={onEditDone}
                {...handlers}
              />
            ))}
          </BoardsOverview>
        )}
        {showBoard && (
          <div className="board-layer" data-fade={boardFade ?? undefined} inert={busy || undefined}>
            {culled(baseBoard.items, win, keep).map((item) => (
              <Block
                key={item.id}
                item={item}
                selected={!searchActive && baseBoard.selected.has(item.id)}
                dragging={dragging}
                dimmed={searchActive && !search.view?.settling}
                hiRes={hiRes}
                lowDetail={lowDetail}
                board={item.boardId ? subBoard(item.boardId) : undefined}
                drop={folder?.id === item.id ? folder.state : undefined}
                editing={!searchActive && editingItemId === item.id}
                onEditDone={onEditDone}
                {...handlers}
              />
            ))}
            {search.leaving.map(({ item, delay }) => (
              <Block key={`out-${item.id}`} item={item} selected={false} dragging={false} phase="exit" delay={delay} {...NOOP_HANDLERS} />
            ))}
            {searchActive &&
              culled(search.board.items, win, keep).map((item) => {
                const delay = search.view?.enter.get(item.id);
                return (
                  <Block
                    key={item.id}
                    item={item}
                    selected={search.board.selected.has(item.id)}
                    dragging={dragging}
                    phase={delay === undefined ? undefined : 'enter'}
                    delay={delay}
                    hiRes={hiRes}
                    lowDetail={lowDetail}
                    editing={editingItemId === item.id}
                    onEditDone={onEditDone}
                    {...handlers}
                  />
                );
              })}
          </div>
        )}
      </div>
      {box && <div className="marquee" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      {focus && <FocusView items={focus.items} startId={focus.id} origin={focus.origin} onClose={() => setFocus(null)} />}
      <div className="canvas-chrome">
        {showBoard && (
          <ResultsBar
            view={search.view ? { label: search.view.label, count: search.board.items.length } : null}
            onKeep={search.onKeep}
            onDone={search.onDone}
          />
        )}
        {boardActive && selectedItems.length > 0 && !dragging && (
          <SelectionMenu
            camera={camera}
            items={selectedItems}
            onAddToBoard={searchActive ? () => search.onKeepItems(selectedItems.map((i) => i.id)) : undefined}
            onFront={() => board.bringToFront(selectedItems.map((i) => i.id))}
            onDuplicate={() => board.duplicate(selectedItems.map((i) => i.id))}
            onDelete={() => removeItems(selectedItems.map((i) => i.id))}
            userRefIds={userRefIds}
            onDeleteFromLibrary={() => onDeleteRefs(userRefIds)}
          />
        )}
        {bottom}
      </div>
    </div>
  );
}
