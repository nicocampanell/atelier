import { memo, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { BOARD_TILE_H, BOARD_TILE_W, type BoardMeta } from '../state/contracts';
import { REF_DRAG_MIME, type BoardItem } from '../types';
import { FRAME_PAD } from '../canvas/surfaceBridge';
import { BoardPreview } from './BoardPreview';
import { useFileDrop } from '../add/useFileDrop';
import './boards.css';

const DRAG_THRESHOLD = 3;

export interface TileActions {
  open(id: string): void;
  move(id: string, dx: number, dy: number): void;
  /** World px per screen px is 1 / zoom; the overview supplies the live zoom. */
  zoom(): number;
  dragStart(pointerId: number, id: string): void;
  dragMove(pointerId: number, id: string, tx: number, ty: number): void;
  dragEnd(): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  startRename(id: string | null): void;
  drop(id: string, refId: string): void;
  /** Files dropped from Finder onto this tile. */
  dropFiles(id: string, files: File[]): void;
}

interface Props {
  meta: BoardMeta;
  items: BoardItem[];
  actions: TileActions;
  renaming: boolean;
  /** This tile is the one being entered or left (its chrome fades, the others vanish). */
  focus: boolean;
  pulse: boolean;
  /** Free cards are being dragged over this tile. */
  over?: boolean;
}

const countLabel = (n: number) => `${n} ${n === 1 ? 'reference' : 'references'}`;
const hasRef = (e: DragEvent) => Array.from(e.dataTransfer.types).includes(REF_DRAG_MIME);

interface Drag {
  pointerId: number;
  sx: number;
  sy: number;
  lx: number;
  ly: number;
  started: boolean;
  tx: number;
  ty: number;
}

function BoardTileImpl({ meta, items, actions, renaming, focus, pulse, over }: Props) {
  const { id } = meta;
  const name = meta.name || 'Untitled board';
  const drag = useRef<Drag | null>(null);
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed');
  const [dropOver, setDropOver] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  // Close the menu on an outside press or Escape.
  useEffect(() => {
    if (menu === 'closed') return;
    const onDown = (e: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu('closed');
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMenu('closed');
      moreRef.current?.focus();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.button !== 0 || renaming) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, lx: e.clientX, ly: e.clientY, started: false, tx: 0, ty: 0 };
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.started) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
      d.started = true;
      setMenu('closed');
      actions.dragStart(d.pointerId, id);
    }
    const z = actions.zoom();
    const dx = (e.clientX - d.lx) / z;
    const dy = (e.clientY - d.ly) / z;
    d.lx = e.clientX;
    d.ly = e.clientY;
    d.tx += dx;
    d.ty += dy;
    actions.move(id, dx, dy);
    actions.dragMove(d.pointerId, id, d.tx, d.ty);
  };
  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    if (d.started) actions.dragEnd();
    else if (e.type === 'pointerup') actions.open(id);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      actions.open(id);
    }
  };

  const fileDrop = useFileDrop({ accept: () => true, onFiles: (files) => actions.dropFiles(id, files) });

  const onDragOver = (e: DragEvent) => {
    if (!hasRef(e)) return fileDrop.handlers.onDragOver(e);
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDropOver(true);
  };
  const onDragLeave = (e: DragEvent) => {
    fileDrop.handlers.onDragLeave(e);
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
  };
  const onDrop = (e: DragEvent) => {
    setDropOver(false);
    if (!hasRef(e)) return fileDrop.handlers.onDrop(e);
    e.preventDefault();
    actions.drop(id, e.dataTransfer.getData(REF_DRAG_MIME));
  };

  const cls = ['tile', focus && 'is-focus', menu !== 'closed' && 'is-menu', (dropOver || over || fileDrop.active) && 'is-drop', pulse && 'is-pulse'].filter(Boolean).join(' ');

  return (
    <div
      ref={rootRef}
      className={cls}
      data-tile
      style={{ left: meta.x, top: meta.y, width: BOARD_TILE_W, height: BOARD_TILE_H }}
    >
      <div
        className="tile__frame"
        role={renaming ? undefined : 'button'}
        tabIndex={renaming ? undefined : 0}
        aria-label={renaming ? undefined : `Open board ${name}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="tile__card" style={{ inset: FRAME_PAD - 1 }}>
          <div className="tile__preview">
            <BoardPreview items={items} />
          </div>
          <div className="tile__meta">
            {renaming ? (
              <RenameInput
                className="tile__rename"
                initial={meta.name}
                label="Board name"
                onCommit={(v) => {
                  actions.rename(id, v);
                  actions.startRename(null);
                }}
                onCancel={() => actions.startRename(null)}
              />
            ) : (
              <div className="tile__name">{name}</div>
            )}
            <div className="tile__count">{countLabel(items.length)}</div>
          </div>
        </div>
      </div>

      {!renaming && (
        <>
          <button
            ref={moreRef}
            type="button"
            className="tile__more"
            aria-label={`Board options for ${name}`}
            aria-haspopup="menu"
            aria-expanded={menu !== 'closed'}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))}
          >
            <MoreHorizontal size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
          {menu !== 'closed' && (
            <div className="tile__menu" role="menu" aria-label={`${name} options`} onPointerDown={(e) => e.stopPropagation()}>
              {menu === 'open' ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    className="tile__menu-item"
                    autoFocus
                    onClick={() => {
                      setMenu('closed');
                      actions.startRename(id);
                    }}
                  >
                    Rename
                  </button>
                  <button type="button" role="menuitem" className="tile__menu-item is-danger" onClick={() => setMenu('confirm')}>
                    Delete
                  </button>
                </>
              ) : (
                <div className="tile__confirm">
                  <div className="tile__confirm-text" role="alert">
                    Delete board?
                  </div>
                  <div className="tile__confirm-row">
                    <button type="button" className="tile__confirm-btn is-danger" autoFocus onClick={() => actions.remove(id)}>
                      Delete
                    </button>
                    <button type="button" className="tile__confirm-btn" onClick={() => setMenu('open')}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export const BoardTile = memo(BoardTileImpl);

/** Single-line inline input: Enter (or blur) saves, Escape cancels. */
export function RenameInput({
  initial,
  className,
  label,
  onCommit,
  onCancel,
}: {
  initial: string;
  className: string;
  label: string;
  onCommit(value: string): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value.trim());
    else onCancel();
  };
  return (
    <input
      className={className}
      value={value}
      aria-label={label}
      placeholder="Untitled board"
      maxLength={60}
      autoFocus
      spellCheck={false}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => finish(true)}
    />
  );
}

interface NewProps {
  x: number;
  y: number;
  onCreate(): void;
}

export function NewBoardTile({ x, y, onCreate }: NewProps) {
  return (
    <div className="tile tile--new" data-tile style={{ left: x, top: y, width: BOARD_TILE_W, height: BOARD_TILE_H }}>
      <button
        type="button"
        className="tile__frame tile__new"
        aria-label="New board"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onCreate}
      >
        <Plus size={28} strokeWidth={1.5} aria-hidden="true" />
        <span>New board</span>
      </button>
    </div>
  );
}
