import { memo, useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { ExternalLink, Folder, Link as LinkIcon } from 'lucide-react';
import type { BoardItem } from '../types';
import { BoardPreview } from '../boards/BoardPreview';
import { PREVIEW_H, PREVIEW_W } from '../boards/geometry';
import { LINK_SIZE, ensureOriginal, linkImageHeight, refsInternal, useReference } from '../refs/store';
import { NoteEditor } from '../add/NoteEditor';
import { StatusOverlay } from '../add/StatusOverlay';
import { FRAME_PAD } from './surfaceBridge';
import './canvas.css';

export interface BlockHandlers {
  onPointerDown(e: PointerEvent<HTMLElement>, id: string): void;
  onPointerMove(e: PointerEvent<HTMLElement>, id: string): void;
  onPointerUp(e: PointerEvent<HTMLElement>, id: string): void;
  onKeyDown(e: KeyboardEvent<HTMLElement>, id: string): void;
  onDoubleClick(e: MouseEvent<HTMLElement>, id: string): void;
}

interface Props extends BlockHandlers {
  item: BoardItem;
  selected: boolean;
  /** A drag is in progress (lift applies to selected blocks only). */
  dragging: boolean;
  /** Search view is covering the board: fade back and stop taking input. */
  dimmed?: boolean;
  /** Entrance / exit animation for search-view result blocks. */
  phase?: 'enter' | 'exit';
  /** Animation delay in ms (the stagger). */
  delay?: number;
  /** Zoomed in past 1.5: show the full-size image instead of the thumbnail. */
  hiRes?: boolean;
  /** Zoomed far out: image blocks fade to a plain box in the reference's color (no <img>, no hover chrome). */
  lowDetail?: boolean;
  /** A user note being edited inline. */
  editing?: boolean;
  onEditDone?(): void;
  /** The child board this card stands for; the parent passes it when item.boardId is set. */
  board?: { name: string; items: BoardItem[] };
  /** Sub-board card during a drag: a selection is over it, or it just took one in. */
  drop?: 'over' | 'received';
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const;

/** Sub-board card: the preview box (PREVIEW_W x PREVIEW_H) is scaled to fit above the footer. */
const BOARD_INSET = 6;
const BOARD_FOOTER = 40;
const stop = (e: { stopPropagation(): void }) => e.stopPropagation();

/** Images already fetched this session, so a remounted block does not fade in again. */
const LOADED = new Set<string>();

interface ShellProps extends BlockHandlers {
  item: BoardItem;
  className: string;
  label: string;
  selected: boolean;
  inert: boolean;
  phase?: 'enter' | 'exit';
  delay?: number;
  children: ReactNode;
}

/** The positioned, focusable, draggable root shared by every block kind. */
function Shell({ item, className, label, selected, inert, phase, delay, children, ...h }: ShellProps) {
  return (
    <div
      className={className}
      data-block={item.id}
      data-phase={phase}
      inert={inert || undefined}
      tabIndex={0}
      role="group"
      aria-label={label}
      style={{
        left: item.x - FRAME_PAD,
        top: item.y - FRAME_PAD,
        width: item.w + FRAME_PAD * 2,
        height: item.h + FRAME_PAD * 2,
        zIndex: item.z,
        ...(phase ? ({ '--delay': `${delay ?? 0}ms` } as CSSProperties) : null),
      }}
      onPointerDown={(e) => h.onPointerDown(e, item.id)}
      onPointerMove={(e) => h.onPointerMove(e, item.id)}
      onPointerUp={(e) => h.onPointerUp(e, item.id)}
      onPointerCancel={(e) => h.onPointerUp(e, item.id)}
      onKeyDown={(e) => h.onKeyDown(e, item.id)}
      onDoubleClick={(e) => h.onDoubleClick(e, item.id)}
    >
      {children}
      {selected && (
        <>
          {CORNERS.map((c) => (
            <i key={c} className={`block__handle block__handle--${c}`} data-corner={c} aria-hidden="true" />
          ))}
        </>
      )}
    </div>
  );
}

function BlockImpl({ item, selected, dragging, dimmed, phase, delay, hiRes, lowDetail, editing, onEditDone, board, drop, ...h }: Props) {
  const ref = useReference(item.refId);
  const shown = ref ? (hiRes ? (ref.src ?? ref.thumbSrc) : (ref.thumbSrc ?? ref.src)) : undefined;
  const needsOriginal = hiRes && ref?.kind === 'image' && !ref.src;
  useEffect(() => {
    if (needsOriginal) void ensureOriginal(item.refId);
  }, [needsOriginal, item.refId]);
  const [loaded, setLoaded] = useState(() => !!shown && LOADED.has(shown));
  const inert = !!dimmed || phase === 'exit';
  const lifted = selected && dragging;
  const state = [selected && 'is-selected', lifted && 'is-lifted', dimmed && 'is-dimmed', drop && `is-drop-${drop}`];
  const shell = { item, selected, inert, phase, delay, ...h };
  // Low detail: the image fades out first (CSS), then unmounts so 1000 far-off cards are just boxes.
  const [imgGone, setImgGone] = useState(false);
  useEffect(() => {
    if (!lowDetail) return;
    const t = setTimeout(() => setImgGone(true), 200);
    return () => {
      clearTimeout(t);
      setImgGone(false);
    };
  }, [lowDetail]);
  const plain = !!lowDetail && imgGone;

  if (!ref) {
    if (!item.boardId) return null;
    const name = board?.name || 'Untitled board';
    const items = board?.items ?? [];
    const scale = Math.max(0.05, Math.min((item.w - BOARD_INSET * 2) / PREVIEW_W, (item.h - BOARD_INSET - BOARD_FOOTER) / PREVIEW_H));
    return (
      <Shell {...shell} className={['block', 'block--board', ...state].filter(Boolean).join(' ')} label={`Board: ${name}`}>
        <div className="block__stack" aria-hidden="true" />
        <div className="block__card">
          <div className="block__board-preview">
            <div className="block__board-box" style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
              <BoardPreview items={items} />
            </div>
          </div>
          <div className="block__board-meta">
            <Folder className="block__board-icon" size={14} strokeWidth={2} aria-hidden="true" />
            <span className="block__board-name">{name}</span>
            <span className="block__board-count">· {items.length}</span>
          </div>
        </div>
      </Shell>
    );
  }

  const pictured = ref.kind === 'image' || (ref.kind === 'link' && !!shown);
  const markLoaded = (img: HTMLImageElement) => {
    if (shown) LOADED.add(shown);
    setLoaded(true);
    if (ref.kind === 'link' && ref.h === LINK_SIZE.h && img.naturalWidth) {
      refsInternal.update(ref.id, { h: linkImageHeight(img.naturalWidth, img.naturalHeight) });
    }
  };

  const cls = ['block', `block--${pictured ? 'image' : ref.kind}`, ref.status === 'failed' && 'is-failed', ...state, lowDetail && 'is-lod'].filter(Boolean).join(' ');

  return (
    <Shell {...shell} className={cls} label={ref.title}>
      <div
        className="block__card"
        title={ref.status === 'failed' ? ref.error : undefined}
        style={pictured ? { background: ref.color } : undefined}
      >
        {pictured && shown && !plain && (
          <>
            <img
              className={loaded && !lowDetail ? 'block__img is-loaded' : 'block__img'}
              src={shown}
              alt=""
              draggable={false}
              loading="eager" decoding="async"
              onLoad={(e) => markLoaded(e.currentTarget)}
            />
            <div className="block__caption">
              <span className="block__caption-title">{ref.title}</span>
              <span className="block__caption-source">{ref.source}</span>
            </div>
          </>
        )}
        {ref.kind === 'image' && !shown && !plain && (
          <div className="block__caption">
            <span className="block__caption-title">{ref.title}</span>
            <span className="block__caption-source">{ref.source}</span>
          </div>
        )}
        {ref.kind === 'note' && editing && ref.userAdded && <NoteEditor reference={ref} onDone={() => onEditDone?.()} />}
        {ref.kind === 'note' && !(editing && ref.userAdded) && (
          <div className="block__note">
            <div className="block__note-title">{ref.title}</div>
            <p className="block__note-body">{ref.body}</p>
          </div>
        )}
        {ref.kind === 'link' && !shown && (
          <div className="block__link">
            <LinkIcon className="block__link-icon" size={14} strokeWidth={2} aria-hidden="true" />
            <div className="block__link-text">
              <div className="block__link-title">{ref.title}</div>
              <div className="block__link-source">{ref.source}</div>
              {ref.body && <div className="block__link-desc">{ref.body}</div>}
            </div>
          </div>
        )}
        <StatusOverlay reference={ref} />
        {ref.kind === 'link' && ref.url && !plain && (
          <a
            className="block__visit"
            href={ref.url}
            target="_blank"
            rel="noopener"
            aria-label={`Visit ${ref.source}`}
            title={`Visit ${ref.source}`}
            draggable={false}
            onPointerDown={stop}
            onClick={stop}
            onDoubleClick={stop}
          >
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
      </div>
    </Shell>
  );
}

export const Block = memo(BlockImpl);
