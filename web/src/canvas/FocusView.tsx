import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import type { BoardItem, Reference } from '../types';
import { ensureOriginal, useReference } from '../refs/store';
import { focusOrder } from './focusOrder';
import './focus.css';

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** dir 0 = first open (FLIP from the card), otherwise the direction of travel. */
function Stage({ item, reference, dir, origin }: { item: BoardItem; reference: Reference; dir: -1 | 0 | 1; origin: DOMRect | null }) {
  const el = useRef<HTMLDivElement>(null);
  const first = useRef({ dir, origin }); // each item gets its own keyed Stage, so these only matter on mount

  useLayoutEffect(() => {
    const node = el.current;
    if (!node) return;
    const { dir, origin } = first.current;
    let frames: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
    let duration = 180;
    if (!reducedMotion()) {
      if (dir === 0 && origin) {
        const r = node.getBoundingClientRect();
        const dx = origin.left + origin.width / 2 - (r.left + r.width / 2);
        const dy = origin.top + origin.height / 2 - (r.top + r.height / 2);
        frames = [{ transform: `translate(${dx}px, ${dy}px) scale(${origin.width / r.width})` }, { transform: 'none' }];
        duration = 320;
      } else if (dir !== 0) {
        frames = [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }];
      }
    }
    const a = node.animate(frames, { duration, easing: EASE });
    return () => a.cancel();
  }, []);

  const src = reference.src ?? reference.thumbSrc;
  const ar = { '--ar': item.w / item.h } as CSSProperties;

  if (reference.kind === 'note') {
    return (
      <div ref={el} className="focus__stage focus__stage--card">
        <h2 className="focus__card-title">{reference.title}</h2>
        <p className="focus__card-body">{reference.body}</p>
      </div>
    );
  }
  if (reference.kind === 'link' && !src) {
    return (
      <div ref={el} className="focus__stage focus__stage--card focus__stage--link">
        <h2 className="focus__card-title">{reference.title}</h2>
        <p className="focus__card-source">{reference.source}</p>
        {reference.body && <p className="focus__card-body">{reference.body}</p>}
        {reference.url && (
          <a className="focus__pill focus__visit" href={reference.url} target="_blank" rel="noopener">
            <ExternalLink size={14} aria-hidden="true" />
            <span>Visit page</span>
          </a>
        )}
      </div>
    );
  }
  const img = <img className="focus__img" src={src} alt={reference.kind === 'image' ? reference.title : ''} draggable={false} />;
  return (
    <div ref={el} className="focus__stage" style={{ ...ar, background: reference.color }}>
      {reference.kind === 'link' && reference.url ? (
        <a className="focus__media" href={reference.url} target="_blank" rel="noopener" aria-label={`Visit ${reference.title}`}>
          {img}
          <span className="focus__pill">
            <ExternalLink size={14} aria-hidden="true" />
            <span>{reference.source}</span>
          </span>
        </a>
      ) : (
        img
      )}
    </div>
  );
}

export function FocusView({ items, startId, origin, onClose }: { items: BoardItem[]; startId: string; origin: DOMRect | null; onClose(): void }) {
  const [view, setView] = useState<{ id: string; dir: -1 | 0 | 1 }>({ id: startId, dir: 0 });
  const root = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const order = focusOrder(items);
  const index = order.findIndex((i) => i.id === view.id);
  const item = order[index];
  const reference = useReference(item?.refId ?? '');
  const refId = item?.refId;

  // Cards show thumbnails; focus swaps in the full-size original once it is read.
  useEffect(() => {
    if (refId) void ensureOriginal(refId);
  }, [refId]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    if (!reducedMotion()) root.current?.firstElementChild?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, easing: EASE });
    return () => prev?.focus?.({ preventScroll: true });
  }, []);

  if (!item || !reference) return null;

  const step = (d: -1 | 1) => !closing.current && setView({ id: order[(index + d + order.length) % order.length].id, dir: d });
  const close = () => {
    const node = root.current;
    if (closing.current || !node) return;
    closing.current = true;
    const opts = { duration: 160, easing: EASE, fill: 'forwards' } as const;
    node.querySelector('.focus__stage')?.animate([{ transform: 'none' }, { transform: 'scale(0.96)' }], opts);
    node.animate([{ opacity: 1 }, { opacity: 0 }], opts).onfinish = onClose;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the canvas and app shortcuts stay quiet while the focus view is open
    if (e.key === 'Tab') {
      const nodes = root.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const cur = document.activeElement;
      if (e.shiftKey && (cur === first || cur === root.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && cur === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if (next || e.key === 'ArrowLeft' || e.key === 'ArrowUp') step(next ? 1 : -1);
    else if (e.key === 'Escape') close();
    else return;
    e.preventDefault();
  };

  return createPortal(
    <div
      ref={root}
      className="focus"
      role="dialog"
      aria-modal="true"
      aria-label={reference.title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // Portals bubble React events to the canvas, whose marquee would capture the pointer and swallow the backdrop click.
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="focus__backdrop" onClick={close} />
      <div className="focus__layer">
        <Stage key={item.id} item={item} reference={reference} dir={view.dir} origin={origin} />
        <div key={`${item.id}-caption`} className="focus__caption">
          <span className="focus__title">{reference.title}</span>
          <span className="focus__meta">
            {reference.source} · {index + 1} / {order.length}
          </span>
        </div>
      </div>
      <button type="button" className="focus__btn focus__btn--prev" aria-label="Previous card" onClick={() => step(-1)}>
        <ChevronLeft size={20} aria-hidden="true" />
      </button>
      <button type="button" className="focus__btn focus__btn--next" aria-label="Next card" onClick={() => step(1)}>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
      <button ref={closeBtn} type="button" className="focus__btn focus__btn--close" aria-label="Close" onClick={close}>
        <X size={20} aria-hidden="true" />
      </button>
    </div>,
    document.body,
  );
}
