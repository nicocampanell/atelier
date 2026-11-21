import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './add.css';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/** Centred modal: role=dialog, focus trap, Esc / scrim closes, focus returns to what opened it. */
export function Dialog({ title, onClose, children }: { title: string; onClose(): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const root = ref.current;
    (root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => prev?.focus?.({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation(); // the canvas and app shortcuts stay quiet while a dialog is open
    if (e.key === 'Escape') {
      e.preventDefault();
      closeRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !ref.current?.contains(cur))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="dlg-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dlg" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={onKeyDown}>
        <h2 id={titleId} className="dlg__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
