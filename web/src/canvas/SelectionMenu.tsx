import { useCallback, useLayoutEffect, useEffect, useRef } from 'react';
import { ArrowUpToLine, Copy, Plus, Trash2 } from 'lucide-react';
import type { BoardItem } from '../types';
import type { CameraApi } from './useCamera';
import { FRAME_PAD } from './surfaceBridge';
import '../add/add.css';

interface Props {
  camera: CameraApi;
  /** The selected items (non-empty). */
  items: BoardItem[];
  /** Search results only: add the selection to the board. */
  onAddToBoard?: () => void;
  onFront(): void;
  onDuplicate(): void;
  onDelete(): void;
  /** User references among the selection; the library delete shows only when there are some. */
  userRefIds: string[];
  onDeleteFromLibrary(): void;
}

const GAP = 12;
const MARGIN = 8;

/** Floating glass toolbar that tracks the selection's screen bounding box. */
export function SelectionMenu({ camera, items, onAddToBoard, onFront, onDuplicate, onDelete, userRefIds, onDeleteFromLibrary }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);

  const place = useCallback(() => {
    const el = ref.current;
    const frame = camera.frameRef.current;
    if (!el || !frame) return;
    const cam = camera.get();
    const list = itemsRef.current;
    const minX = (Math.min(...list.map((i) => i.x)) - FRAME_PAD) * cam.zoom + cam.x;
    const maxX = (Math.max(...list.map((i) => i.x + i.w)) + FRAME_PAD) * cam.zoom + cam.x;
    const minY = (Math.min(...list.map((i) => i.y)) - FRAME_PAD) * cam.zoom + cam.y;
    const maxY = (Math.max(...list.map((i) => i.y + i.h)) + FRAME_PAD) * cam.zoom + cam.y;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let top = minY - GAP - h;
    if (top < MARGIN) top = maxY + GAP; // no room above: sit below the selection
    top = Math.min(Math.max(top, MARGIN), frame.clientHeight - h - MARGIN);
    const left = Math.min(Math.max((minX + maxX) / 2 - w / 2, MARGIN), frame.clientWidth - w - MARGIN);
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }, [camera]);

  useLayoutEffect(() => {
    itemsRef.current = items;
    place();
  }, [items, place]);

  useEffect(() => camera.subscribe(place), [camera, place]);

  return (
    <div ref={ref} className="selection-menu glass" data-chrome role="toolbar" aria-label="Selection actions">
      {onAddToBoard && (
        <button type="button" className="icon-btn" aria-label="Add to board" title="Add to board" onClick={onAddToBoard}>
          <Plus size={16} strokeWidth={1.75} />
        </button>
      )}
      <button type="button" className="icon-btn" aria-label="Bring to front" title="Bring to front" onClick={onFront}>
        <ArrowUpToLine size={16} strokeWidth={1.75} />
      </button>
      <button type="button" className="icon-btn" aria-label="Duplicate" title="Duplicate" onClick={onDuplicate}>
        <Copy size={16} strokeWidth={1.75} />
      </button>
      <button type="button" className="icon-btn" aria-label="Delete" title="Delete" onClick={onDelete}>
        <Trash2 size={16} strokeWidth={1.75} />
      </button>
      {userRefIds.length > 0 && (
        <button type="button" className="selection-menu__text" onClick={onDeleteFromLibrary}>
          Delete from library
        </button>
      )}
    </div>
  );
}
