import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import './add.css';

export interface ToastAction {
  label: string;
  run(): void;
}

export interface ToastSpec {
  text: string;
  /** Extra lines (rejected files). */
  lines?: string[];
  /** 'error' renders with role="alert" and a dismiss button. */
  kind?: 'status' | 'error';
  actions?: ToastAction[];
  /** Lifetime in ms. Default 5000. */
  ms?: number;
  /** Runs when the toast times out (or the page is hidden) without an action being taken. */
  onExpire?(): void;
}

interface ToastItem extends ToastSpec {
  id: number;
}

export interface ToastsApi {
  push(spec: ToastSpec): void;
}

export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const live = useRef<ToastItem[]>([]);
  const nextId = useRef(0);

  const remove = useCallback((id: number, expired: boolean) => {
    const t = live.current.find((x) => x.id === id);
    if (!t) return;
    live.current = live.current.filter((x) => x.id !== id);
    setToasts(live.current);
    if (expired) t.onExpire?.();
  }, []);

  const push = useCallback((spec: ToastSpec) => {
    const item = { ...spec, id: ++nextId.current };
    live.current = [...live.current, item];
    setToasts(live.current);
  }, []);

  // A closing page ends every pending undo window.
  useEffect(() => {
    const flush = () => {
      const pending = live.current;
      live.current = [];
      for (const t of pending) t.onExpire?.();
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  return { toasts, push, remove };
}

function ToastView({ toast, onDone }: { toast: ToastItem; onDone(id: number, expired: boolean): void }) {
  const [paused, setPaused] = useState(false);
  const ms = toast.ms ?? 5000;

  useEffect(() => {
    if (paused) return;
    const id = window.setTimeout(() => onDone(toast.id, true), ms);
    return () => window.clearTimeout(id);
  }, [paused, ms, toast.id, onDone]);

  const isError = toast.kind === 'error';
  return (
    <div
      className={isError ? 'toast toast--stack toast--error' : 'toast toast--stack'}
      role={isError ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="toast__body">
        <span className="toast__text">{toast.text}</span>
        {toast.lines && toast.lines.length > 0 && (
          <ul className="toast__lines">
            {toast.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
      </div>
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          type="button"
          className="toast__action"
          onClick={() => {
            onDone(toast.id, false);
            a.run();
          }}
        >
          {a.label}
        </button>
      ))}
      {isError && (
        <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => onDone(toast.id, false)}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Bottom-centre stack of toasts; each keeps its own timer. */
export function ToastStack({ toasts, onDone }: { toasts: ToastItem[]; onDone(id: number, expired: boolean): void }) {
  if (!toasts.length) return null;
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} onDone={onDone} />
      ))}
    </div>
  );
}
