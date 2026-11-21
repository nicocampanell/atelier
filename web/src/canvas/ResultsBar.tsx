import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';

export interface ResultsBarView {
  label: string;
  count: number;
}

interface Props {
  /** null while no search view is active; the bar plays a short exit then unmounts. */
  view: ResultsBarView | null;
  onKeep(): void;
  onDone(): void;
}

const EXIT_MS = 160;

/** Floating, solid (not glass) status bar for the search view. */
export function ResultsBar({ view, onKeep, onDone }: Props) {
  // Keep the last view around so the bar can animate out.
  const [snap, setSnap] = useState<ResultsBarView | null>(view);
  if (view && (snap?.label !== view.label || snap.count !== view.count)) setSnap(view);

  useEffect(() => {
    if (view) return;
    const t = window.setTimeout(() => setSnap(null), EXIT_MS + 40);
    return () => window.clearTimeout(t);
  }, [view]);

  if (!snap) return null;
  const closed = !view;

  return (
    <div className="results-bar" data-chrome data-state={closed ? 'closed' : 'open'} inert={closed || undefined}>
      <Search size={16} strokeWidth={1.75} aria-hidden="true" className="results-bar__icon" />
      <span className="results-bar__text" role="status">
        <b>{snap.count}</b> {snap.count === 1 ? 'result' : 'results'} for “<span className="results-bar__label">{snap.label}</span>”
      </span>
      <span className="results-bar__divider" aria-hidden="true" />
      <button type="button" className="results-bar__keep" aria-label="Keep results on board" onClick={onKeep}>
        Keep on board
      </button>
      <button type="button" className="results-bar__done" aria-label="Done, close search results" title="Done (Esc)" onClick={onDone}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
