import { memo, useMemo } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import type { BoardItem } from '../types';
import { useReference } from '../refs/store';
import { previewLayout } from './geometry';
import './boards.css';

function Mini({ item }: { item: BoardItem }) {
  const ref = useReference(item.refId);
  const src = ref?.thumbSrc ?? ref?.src;
  if (!ref) {
    return item.boardId ? <div className="mini mini--board" style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z }} /> : null;
  }
  const pictured = ref.kind === 'image' || (ref.kind === 'link' && !!src);
  return (
    <div
      className={`mini mini--${pictured ? 'image' : ref.kind}`}
      style={{ left: item.x, top: item.y, width: item.w, height: item.h, zIndex: item.z, background: pictured ? ref.color : undefined }}
    >
      {pictured && src && <img className="mini__img" src={src} alt="" draggable={false} loading="eager" decoding="async" />}
      {ref.kind === 'note' && (
        <div className="block__note">
          <div className="block__note-title">{ref.title}</div>
          <p className="block__note-body">{ref.body}</p>
        </div>
      )}
      {ref.kind === 'link' && !src && (
        <div className="block__link">
          <LinkIcon className="block__link-icon" size={14} strokeWidth={2} aria-hidden="true" />
          <div className="block__link-text">
            <div className="block__link-title">{ref.title}</div>
            <div className="block__link-source">{ref.source}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The board's items at their real coordinates, scaled by the same transform "fit to content" yields
 * for the preview box. The enter transition zooms until this scale equals the board's own fit.
 */
function BoardPreviewImpl({ items }: { items: BoardItem[] }) {
  const layout = useMemo(() => previewLayout(items), [items]);
  if (!items.length) {
    return (
      <div className="tile__empty" aria-hidden="true">
        <span>Empty board</span>
      </div>
    );
  }
  return (
    <div
      className="tile__mini"
      aria-hidden="true"
      style={{ transform: `translate(${layout.x}px, ${layout.y}px) scale(${layout.zoom})` }}
    >
      {items.map((item) => (
        <Mini key={item.id} item={item} />
      ))}
    </div>
  );
}

export const BoardPreview = memo(BoardPreviewImpl);
