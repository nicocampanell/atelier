import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { MAIN_ID, type BoardsStore } from '../state/contracts';
import { refsStore } from '../refs/store';
import { FRAME_PAD } from '../canvas/surfaceBridge';
import type { CameraApi } from '../canvas/useCamera';
import { BoardTile, NewBoardTile, type TileActions } from './BoardTile';
import { newTileSlot, overviewFit, TILE_H, TILE_W } from './geometry';
import './boards.css';

export interface OverviewProps {
  store: BoardsStore;
  camera: CameraApi;
  /** The layer element; the enter / exit transition writes a compensating transform to it. */
  layerRef: RefObject<HTMLDivElement | null>;
  /** The tile being entered or left. While `focusing`, its chrome and every other tile fade out. */
  focusId: string | null;
  focusing: boolean;
  fade: 'in' | 'out' | null;
  /** Input is locked during transitions. */
  inert: boolean;
  onOpen(id: string): void;
  /** Files dropped from Finder onto a tile. */
  onFilesToBoard(id: string, files: File[]): void;
  /** Surface Field footprint for a tile drag. */
  carry(pointerId: number, origin: { id: string; x: number; y: number; w: number; h: number }[], tx: number, ty: number): void;
  onDragging(dragging: boolean): void;
  /** The main area's free cards, drawn in the same layer so they fade and zoom with the tiles. */
  children?: ReactNode;
  /** A dragged selection of free cards is over a tile ('over'), or a tile just took it in ('received'). */
  drop?: { id: string; state: 'over' | 'received' } | null;
}

const PULSE_MS = 700;

/** The boards overview: one tile per board in world space, plus a "+ New board" slot. */
export function BoardsOverview({ store, camera, layerRef, focusId, focusing, fade, inert, onOpen, onFilesToBoard, carry, onDragging, children, drop }: OverviewProps) {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const boards = useMemo(() => store.boards.filter((b) => !b.parentId), [store.boards]);
  const slot = useMemo(() => newTileSlot(boards), [boards]);

  const latest = useRef({ store, onOpen, onFilesToBoard, carry, onDragging, boards });
  useEffect(() => {
    latest.current = { store, onOpen, onFilesToBoard, carry, onDragging, boards };
  });

  const dragOrigin = useRef<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const pulseTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(pulseTimer.current), []);

  const pulse = useCallback((id: string) => {
    setPulseId(id);
    window.clearTimeout(pulseTimer.current);
    pulseTimer.current = window.setTimeout(() => setPulseId(null), PULSE_MS);
  }, []);

  const actions = useMemo<TileActions>(
    () => ({
      open: (id) => latest.current.onOpen(id),
      move: (id, dx, dy) => latest.current.store.moveTile(id, dx, dy),
      zoom: () => camera.get().zoom,
      dragStart: (_pointerId, id) => {
        const b = latest.current.boards.find((m) => m.id === id);
        if (b) dragOrigin.current = { id, x: b.x + FRAME_PAD, y: b.y + FRAME_PAD, w: TILE_W - FRAME_PAD * 2, h: TILE_H - FRAME_PAD * 2 };
        latest.current.onDragging(true);
      },
      dragMove: (pointerId, _id, tx, ty) => {
        if (dragOrigin.current) latest.current.carry(pointerId, [dragOrigin.current], tx, ty);
      },
      dragEnd: () => latest.current.onDragging(false),
      rename: (id, name) => latest.current.store.rename(id, name),
      remove: (id) => latest.current.store.remove(id),
      startRename: setRenamingId,
      drop: (id, refId) => {
        if (!refsStore.has(refId)) return;
        if (!latest.current.store.addRef(id, refId)) return;
        pulse(id);
      },
      dropFiles: (id, files) => {
        latest.current.onFilesToBoard(id, files);
        pulse(id);
      },
    }),
    [camera, pulse],
  );

  const create = () => {
    const id = store.create('');
    setRenamingId(id);
  };

  // After creating a tile, bring it into view if it landed off screen.
  const count = useRef(boards.length);
  useEffect(() => {
    const grew = boards.length > count.current;
    count.current = boards.length;
    if (!grew) return;
    const f = camera.frameSize();
    const cam = camera.get();
    const t = boards[boards.length - 1];
    const l = t.x * cam.zoom + cam.x;
    const tp = t.y * cam.zoom + cam.y;
    const visible = l >= 0 && tp >= 0 && l + TILE_W * cam.zoom <= f.w && tp + TILE_H * cam.zoom <= f.h;
    if (!visible) camera.animateTo(overviewFit(boards, f.w, f.h, store.itemsOf(MAIN_ID)), true);
  }, [boards, camera]);

  return (
    <div
      ref={layerRef}
      className={focusing ? 'overview-layer is-focusing' : 'overview-layer'}
      data-fade={fade ?? undefined}
      inert={inert || undefined}
      role="group"
      aria-label="Boards"
    >
      {boards.map((meta) => (
        <BoardTile
          key={meta.id}
          meta={meta}
          items={store.itemsOf(meta.id)}
          actions={actions}
          renaming={renamingId === meta.id}
          focus={focusId === meta.id}
          pulse={pulseId === meta.id || (drop?.id === meta.id && drop.state === 'received')}
          over={drop?.id === meta.id && drop.state === 'over'}
        />
      ))}
      <NewBoardTile x={slot.x} y={slot.y} onCreate={create} />
      {children}
    </div>
  );
}
