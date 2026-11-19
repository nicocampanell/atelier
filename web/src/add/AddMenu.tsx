import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ImagePlus, LayoutGrid, Link as LinkIcon, Plug, Plus, StickyNote } from 'lucide-react';
import type { BackendStatus } from '../refs/contracts';
import './add.css';

interface Props {
  status: BackendStatus;
  onUpload(): void;
  onLink(): void;
  onNote(): void;
  onConnect(): void;
  /** Context-menu mode: show only the menu, fixed at this client point. */
  at?: { x: number; y: number };
  onClose?(): void;
  /** Context-menu mode only: nest a new board here. */
  onBoard?(): void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';
const SHIFT = isMac ? '⇧' : 'Shift+';

/** Round "+" in the header with a small menu of ways to add a reference. */
export function AddMenu({ status, onUpload, onLink, onNote, onConnect, at, onClose, onBoard }: Props) {
  const [open, setOpen] = useState(false);
  const isOpen = open || !!at;
  const close = () => (at ? onClose?.() : setOpen(false));
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const connected = status === 'connected';

  useEffect(() => {
    if (!isOpen) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  });

  const choose = (run: () => void) => {
    close();
    btnRef.current?.focus({ preventScroll: true }); // dialogs return focus here
    run();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      btnRef.current?.focus();
      return;
    }
    if (e.key === 'Tab') {
      close();
      return;
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % items.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    if (next < 0) return;
    e.preventDefault();
    items[next]?.focus();
  };

  return (
    <div ref={wrapRef} className="add" onKeyDown={onKeyDown}>
      {!at && <button
        ref={btnRef}
        type="button"
        className="add__btn"
        aria-label={connected ? 'Add reference (backend connected)' : 'Add reference'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
        {connected && <span className="add__dot" aria-hidden="true" />}
      </button>}
      {isOpen && (
        <div
          ref={menuRef}
          id={menuId}
          className="add__menu"
          role="menu"
          aria-label="Add reference"
          // ponytail: clamps by a fixed estimate of the menu size (~264x240), not its measured box.
          style={at && { position: 'fixed', right: 'auto', transformOrigin: 'top left', left: Math.min(at.x, innerWidth - 272), top: Math.min(at.y, innerHeight - 248) }}
        >
          <button type="button" role="menuitem" className="add__item" onClick={() => choose(onUpload)}>
            <ImagePlus size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="add__label">Upload images…</span>
            <kbd className="add__kbd" aria-hidden="true">{MOD}{SHIFT}U</kbd>
          </button>
          <button type="button" role="menuitem" className="add__item" onClick={() => choose(onLink)}>
            <LinkIcon size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="add__label">Add a link…</span>
            <kbd className="add__kbd" aria-hidden="true">{MOD}{SHIFT}L</kbd>
          </button>
          <button type="button" role="menuitem" className="add__item" onClick={() => choose(onNote)}>
            <StickyNote size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="add__label">New note</span>
            <kbd className="add__kbd" aria-hidden="true">{MOD}{SHIFT}N</kbd>
          </button>
          {onBoard && (
            <button type="button" role="menuitem" className="add__item" onClick={() => choose(onBoard)}>
              <LayoutGrid size={16} strokeWidth={1.75} aria-hidden="true" />
              <span className="add__label">New board</span>
            </button>
          )}
          <div className="add__sep" role="separator" />
          <button type="button" role="menuitem" className="add__item" onClick={() => choose(onConnect)}>
            <Plug size={16} strokeWidth={1.75} aria-hidden="true" />
            <span className="add__label">Connect backend…</span>
            {connected && (
              <span className="add__state">
                <span className="add__dot add__dot--inline" aria-hidden="true" />
                Connected
              </span>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
