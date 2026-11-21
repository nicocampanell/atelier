import {
  useCallback,
  useEffect,
  useDeferredValue,
  useLayoutEffect,
  useMemo,
  memo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Link as LinkIcon, Plus, Search, X } from 'lucide-react';
import { refsStore, useReferences } from '../refs/store';
import { searchSaves } from '../api/client';
import { useBackendStatus } from '../refs/backend';
import { StatusOverlay } from '../add/StatusOverlay';
import { REF_DRAG_MIME, type Reference } from '../types';
import { useRecentSearches } from './useRecentSearches';
import { useRecentlyViewed } from './useRecentlyViewed';
import './search.css';

/** Tags with their counts, most used first. */
export function tagCounts(list: readonly Reference[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of list) for (const t of r.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag, count]) => ({ tag, count }));
}

/** Haystack per reference object; an edited reference is a new object, so it is rebuilt. */
const SEARCH_TEXT = new WeakMap<Reference, string>();
const haystack = (r: Reference) => {
  let text = SEARCH_TEXT.get(r);
  if (text === undefined) {
    text = [r.title, r.tags.join(' '), r.source, r.body ?? ''].join(' ').toLowerCase();
    SEARCH_TEXT.set(r, text);
  }
  return text;
};

/** Every reference whose text contains all query words and that carries every selected tag. */
export function filterReferences(query: string, tags: string[], list: readonly Reference[] = refsStore.getSnapshot().list): Reference[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return list.filter((r) => {
    if (tags.some((t) => !r.tags.includes(t))) return false;
    const hay = haystack(r);
    return words.every((w) => hay.includes(w));
  });
}

/** Beyond the measured video: a subtle top-to-bottom clip reveal of the panel. Set to false to drop it. */
const REVEAL_CLIP = true;
type Phase = 'opening' | 'open' | 'closing';
/** Bar narrowing is 200 ms; unmount just after it lands on the pill. */
const CLOSE_MS = 220;
const CLOSE_MS_REDUCED = 100;
const tileId = (id: string) => `sr-tile-${id}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function SearchBar({
  open,
  onOpen,
  onClose,
  onAdd,
  onShowResults,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onAdd: (ref: Reference) => void;
  /** Lay results out on the canvas. `label` is the query, or the tag names when the query is empty. */
  onShowResults: (refs: Reference[], label: string) => void;
}) {
  const [mounted, setMounted] = useState(open);
  const [phase, setPhase] = useState<Phase>('opening');
  const [landed, setLanded] = useState(false);
  const [query, setQuery] = useState('');
  const [serverMatches, setServerMatches] = useState<{ query: string; ids: string[] } | null>(null);
  const backendStatus = useBackendStatus();
  useEffect(() => {
    const q = query.trim();
    if (!q || backendStatus !== 'connected') return;
    let live = true;
    const timer = window.setTimeout(() => { void searchSaves(q).then((data) => { if (live) setServerMatches({ query: q, ids: [...data.hits, ...data.weaker].map((hit) => hit.save.id) }); }).catch(() => {}); }, 250);
    return () => { live = false; window.clearTimeout(timer); };
  }, [query, backendStatus]);
  const [tags, setTags] = useState<string[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const { list, byId } = useReferences();
  const allTags = useMemo(() => tagCounts(list), [list]);
  const { recents, add: addRecent, clear: clearRecents } = useRecentSearches();
  const { ids: viewedIds, add: addViewed, clear: clearViewed } = useRecentlyViewed();

  const pillRef = useRef<HTMLButtonElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const prevFocus = useRef<HTMLElement | null>(null);
  const pendingViewed = useRef<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const dragRaf = useRef<number | null>(null);
  const dragActive = useRef(false); // a tile drag is in flight: keep it mounted until dragend
  const landedRef = useRef(false); // close animation finished while a drag was still in flight

  // Mount synchronously when opening (adjusting state during render), starting from the
  // "opening" frame (pill width, transparent).
  if (open && !mounted) {
    setMounted(true);
    setPhase('opening');
  }

  // A drag hides the bar with the same close motion, but stays mounted until dragend.
  const visualClosing = !open || dragging;

  const finishClose = useCallback(() => {
    closeTimer.current = null;
    if (dragRaf.current !== null) cancelAnimationFrame(dragRaf.current);
    dragRaf.current = null;
    dragActive.current = false;
    landedRef.current = false;
    setMounted(false);
    setLanded(false);
    setDragging(false);
    setQuery('');
    setTags([]);
    setActive(null);
  }, []);

  // Drive the phase. Measures the real pill each time so the bar starts from / lands on it
  // exactly; flips opening -> open after a forced style flush so the CSS transitions run;
  // reversing mid-flight simply retargets the transitions from their current values.
  useLayoutEffect(() => {
    const layer = layerRef.current;
    if (!mounted || !layer) return;
    const pillW = pillRef.current?.getBoundingClientRect().width;
    if (pillW) layer.style.setProperty('--sr-pill-w', `${pillW}px`);
    if (visualClosing) {
      setPhase('closing');
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      closeTimer.current = window.setTimeout(
        () => {
          closeTimer.current = null;
          if (dragActive.current) {
            landedRef.current = true;
            setLanded(true);
          } else {
            finishClose();
          }
        },
        reduced ? CLOSE_MS_REDUCED : CLOSE_MS,
      );
      return () => {
        if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      };
    }
    void layer.offsetWidth; // commit the start styles before changing state
    setPhase('open');
  }, [mounted, visualClosing, finishClose]);

  // `will-change` only while a transition can be running (set on every phase change, dropped
  // after the longest one, 400 ms + stagger), so the layers are not promoted permanently.
  useLayoutEffect(() => {
    const els = [layerRef.current, scrimRef.current];
    if (!mounted) return;
    els.forEach((el) => el?.classList.add('is-animating'));
    const t = window.setTimeout(() => els.forEach((el) => el?.classList.remove('is-animating')), 500);
    return () => window.clearTimeout(t);
  }, [mounted, visualClosing]);

  useEffect(
    () => () => {
      if (dragRaf.current !== null) cancelAnimationFrame(dragRaf.current);
    },
    [],
  );

  // Focus management: focus immediately on open so the caret is visible from frame 0.
  useLayoutEffect(() => {
    if (open) {
      prevFocus.current = document.activeElement as HTMLElement | null;
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    const el = prevFocus.current;
    prevFocus.current = null;
    el?.focus?.({ preventScroll: true });
  }, [open]);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filtersActive = query.trim() !== '' || tags.length > 0;
  // Typing stays instant; the (1000+ tile) result list catches up at lower priority.
  const deferredQuery = useDeferredValue(query);

  const results = useMemo(() => {
    const local = filterReferences(deferredQuery, tags, list);
    if (serverMatches?.query !== deferredQuery.trim()) return local;
    // Server hits follow the server's ranking, not library order.
    const rank = new Map(serverMatches.ids.map((id, i) => [id, i]));
    const server = list.filter((r) => r.serverId && rank.has(r.serverId) && !local.includes(r) && tags.every((tag) => r.tags.includes(tag)));
    return [...local, ...server.sort((a, b) => rank.get(a.serverId!)! - rank.get(b.serverId!)!)];
  }, [deferredQuery, tags, list, serverMatches]);

  const viewed = useMemo(
    () => viewedIds.map((id) => byId[id]).filter((r): r is Reference => Boolean(r)),
    [viewedIds, byId],
  );

  const items = filtersActive ? results : viewed;
  // While filtering, the first result is active by default so Enter works.
  const activeIndex =
    items.length === 0 ? -1 : Math.min(active ?? (filtersActive ? 0 : -1), items.length - 1);
  const activeItem = activeIndex >= 0 ? items[activeIndex] : undefined;

  // Keep the active tile visible.
  useEffect(() => {
    if (!activeItem) return;
    layerRef.current
      ?.querySelector<HTMLElement>(`#${CSS.escape(tileId(activeItem.id))}`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeItem]);

  const commitAdd = useCallback(
    (ref: Reference, keepOpen: boolean) => {
      addRecent(query);
      addViewed(ref.id);
      onAdd(ref);
      if (!keepOpen) onClose();
    },
    [addRecent, addViewed, onAdd, onClose, query],
  );

  const showOnCanvas = useCallback(
    (q: string, t: string[]) => {
      const refs = q === deferredQuery && t === tags ? results : filterReferences(q, t, list);
      if (!refs.length) return false;
      addRecent(q);
      onShowResults(refs, q.trim().replace(/\s+/g, ' ') || t.join(', '));
      onClose();
      return true;
    },
    [addRecent, onShowResults, onClose, list, deferredQuery, tags, results],
  );

  const clearFilters = () => {
    setQuery('');
    setTags([]);
    setActive(null);
    inputRef.current?.focus();
  };

  const onLayerKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const nodes = layerRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const cur = document.activeElement;
    if (e.shiftKey && (cur === first || !layerRef.current?.contains(cur))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && cur === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const gridColumns = () => {
    const el = listRef.current;
    if (!el || !filtersActive) return 1;
    return Math.max(1, getComputedStyle(el).gridTemplateColumns.split(' ').length);
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    const n = items.length;
    const input = e.currentTarget;
    const caretStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const caretEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
    const cur = Math.max(activeIndex, -1);
    // Recently viewed is a single row: every arrow steps by one.
    const vertical = filtersActive ? gridColumns() : 1;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowDown':
        next = cur < 0 ? 0 : Math.min(cur + vertical, n - 1);
        break;
      case 'ArrowUp':
        next = Math.max(cur - vertical, 0);
        break;
      case 'ArrowRight':
        if (input.value === '' || caretEnd) next = cur < 0 ? 0 : Math.min(cur + 1, n - 1);
        break;
      case 'ArrowLeft':
        if (input.value === '' || caretStart) next = Math.max(cur - 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        if (e.metaKey || e.ctrlKey) {
          if (activeItem) commitAdd(activeItem, true);
        } else if (filtersActive && active === null) {
          // No tile chosen with the arrows: Enter means "all of these".
          showOnCanvas(query, tags);
        } else if (activeItem) {
          commitAdd(activeItem, false);
        }
        return;
    }
    if (next !== null) {
      e.preventDefault();
      if (n > 0) setActive(next);
    }
  };

  const onDragStart = (e: DragEvent<HTMLDivElement>, ref: Reference) => {
    e.dataTransfer.setData(REF_DRAG_MIME, ref.id);
    e.dataTransfer.setData('text/plain', ref.title);
    e.dataTransfer.effectAllowed = 'copy';
    const ghost = e.currentTarget.querySelector<HTMLElement>('.sr-media') ?? e.currentTarget;
    const rect = ghost.getBoundingClientRect();
    e.dataTransfer.setDragImage(ghost, e.clientX - rect.left, e.clientY - rect.top);
    addRecent(query);
    // Defer reordering "recently viewed" so the dragged tile isn't unmounted mid-drag.
    pendingViewed.current = ref.id;
    // Hide (with the close motion) on the next frame; hiding synchronously makes Chrome cancel the drag.
    dragActive.current = true;
    dragRaf.current = requestAnimationFrame(() => {
      dragRaf.current = null;
      setDragging(true);
    });
  };

  const onDragEnd = () => {
    if (pendingViewed.current) {
      addViewed(pendingViewed.current);
      pendingViewed.current = null;
    }
    // The canvas has already handled any drop; close whether or not it landed.
    dragActive.current = false;
    onClose();
    // If the close animation already finished while dragging, unmount now; otherwise its timer does.
    if (landedRef.current) finishClose();
  };

  // Tiles are memoized: handlers go through a stable object that reads the latest closures.
  const latest = useRef<TileActions>(null!);
  useLayoutEffect(() => {
    latest.current = {
      select: (i, r) => {
        setActive(i);
        addViewed(r.id);
      },
      add: commitAdd,
      dragStart: onDragStart,
      dragEnd: onDragEnd,
    };
  });
  const tileActions = useMemo<TileActions>(
    () => ({
      select: (i, r) => latest.current.select(i, r),
      add: (r, keepOpen) => latest.current.add(r, keepOpen),
      dragStart: (e, r) => latest.current.dragStart(e, r),
      dragEnd: () => latest.current.dragEnd(),
    }),
    [],
  );

  const renderTile = (r: Reference, i: number) => (
    <Tile key={r.id} r={r} i={i} active={i === activeIndex} actions={tileActions} />
  );

  const activeId = activeItem ? tileId(activeItem.id) : undefined;
  const showRecent = !filtersActive && recents.length > 0;
  const showViewed = !filtersActive && viewed.length > 0;

  return (
    <>
      <button
        type="button"
        ref={pillRef}
        className="sr-pill"
        data-covered={(mounted && !landed) || undefined}
        aria-label="Search references (⌘K)"
        aria-haspopup="dialog"
        aria-expanded={open}
        inert={open || undefined}
        onClick={onOpen}
      >
        <Search size={20} aria-hidden="true" className="sr-icon" />
        <span className="sr-pill-label">Search references</span>
        <kbd className="sr-kbd sr-pill-kbd" aria-hidden="true">⌘K</kbd>
      </button>

      {mounted && (
        <>
          <div
            ref={scrimRef}
            className="sr-scrim"
            data-state={phase}
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            ref={layerRef}
            className={REVEAL_CLIP ? 'sr-layer sr-reveal' : 'sr-layer'}
            data-state={phase}
            data-landed={landed || undefined}
            role="dialog"
            aria-modal="true"
            aria-label="Search references"
            onKeyDown={onLayerKeyDown}
          >
            <div className="sr-field">
              <Search size={20} aria-hidden="true" className="sr-icon" />
              <input
                ref={inputRef}
                className="sr-input"
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="sr-results"
                aria-activedescendant={activeId}
                aria-label="Search references"
                placeholder="Search references"
                autoComplete="off"
                spellCheck={false}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(null);
                }}
                onKeyDown={onInputKeyDown}
              />
              {query && (
                <button
                  type="button"
                  className="sr-icon-btn"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('');
                    setActive(null);
                    inputRef.current?.focus();
                  }}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              )}
              <kbd className="sr-kbd" aria-hidden="true">esc</kbd>
            </div>

            <div className="sr-panel">
              <div className="sr-panel-inner">
              {showRecent && (
                <section className="sr-section" aria-labelledby="sr-h-recent">
                  <SectionHeader id="sr-h-recent" label="Recent" onClear={clearRecents} />
                  <ul className="sr-chips">
                    {recents.slice(0, 6).map((r) => (
                      <li key={r}>
                        <button
                          type="button"
                          className="sr-chip"
                          onClick={() => {
                            setQuery(r);
                            setActive(null);
                            // Show immediately; if nothing matches, stay open on the empty state.
                            if (!showOnCanvas(r, [])) inputRef.current?.focus();
                          }}
                        >
                          <Search size={18} aria-hidden="true" className="sr-chip-icon" />
                          <span>{r}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="sr-section" aria-labelledby="sr-h-tags">
                <SectionHeader
                  id="sr-h-tags"
                  label="Tags"
                  onClear={tags.length > 0 ? () => { setTags([]); setActive(null); } : undefined}
                />
                <div className="sr-scroller sr-tags" role="group" aria-label="Filter by tag">
                  {allTags.map(({ tag, count }) => {
                    const on = tags.includes(tag);
                    return (
                      <button
                        key={tag}
                        type="button"
                        className="sr-chip sr-tag"
                        aria-pressed={on}
                        data-active={on || undefined}
                        onClick={() => {
                          setTags((cur) => (on ? cur.filter((x) => x !== tag) : [...cur, tag]));
                          setActive(null);
                        }}
                      >
                        {capitalize(tag)}
                        <span className="sr-count">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </section>

              {filtersActive ? (
                <section className="sr-section" aria-labelledby="sr-h-results">
                  <SectionHeader
                    id="sr-h-results"
                    label={`Results · ${results.length}`}
                    live
                    action={{
                      label: 'Show on canvas →',
                      onClick: () => showOnCanvas(query, tags),
                      disabled: results.length === 0,
                    }}
                  />
                  {results.length > 0 ? (
                    <div
                      ref={listRef}
                      id="sr-results"
                      className="sr-grid"
                      role="listbox"
                      aria-label="Results"
                    >
                      {results.map(renderTile)}
                    </div>
                  ) : (
                    <div className="sr-empty" id="sr-results">
                      <p>No references match{query.trim() ? ` “${query.trim()}”` : ' these filters'}</p>
                      <button type="button" className="sr-btn" onClick={clearFilters}>
                        Clear filters
                      </button>
                    </div>
                  )}
                </section>
              ) : (
                showViewed && (
                  <section className="sr-section" aria-labelledby="sr-h-viewed">
                    <SectionHeader id="sr-h-viewed" label="Recently viewed" onClear={clearViewed} />
                    <div
                      ref={listRef}
                      id="sr-results"
                      className="sr-scroller sr-row"
                      role="listbox"
                      aria-label="Recently viewed"
                    >
                      {viewed.map(renderTile)}
                    </div>
                  </section>
                )
              )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function SectionHeader({
  id,
  label,
  onClear,
  live,
  action,
}: {
  id: string;
  label: string;
  onClear?: () => void;
  live?: boolean;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="sr-section-head">
      <h2 id={id} className="sr-label" aria-live={live ? 'polite' : undefined}>
        {label}
      </h2>
      {onClear && (
        <button type="button" className="sr-text-btn" onClick={onClear}>
          Clear
        </button>
      )}
      {action && (
        <button
          type="button"
          className="sr-text-btn sr-text-btn--primary"
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

interface TileActions {
  select(i: number, r: Reference): void;
  add(r: Reference, keepOpen: boolean): void;
  dragStart(e: DragEvent<HTMLDivElement>, r: Reference): void;
  dragEnd(): void;
}

const Tile = memo(function Tile({
  r,
  i,
  active,
  actions,
}: {
  r: Reference;
  i: number;
  active: boolean;
  actions: TileActions;
}) {
  return (
    <div
      id={tileId(r.id)}
      className="sr-tile"
      role="option"
      aria-selected={active}
      data-active={active || undefined}
      draggable={true}
      onClick={() => actions.select(i, r)}
      onDragStart={(e) => actions.dragStart(e, r)}
      onDragEnd={actions.dragEnd}
    >
      <div className="sr-media" data-kind={r.kind}>
        {r.kind === 'image' && (r.thumbSrc ?? r.src) ? (
          <img
            className="sr-thumb"
            src={r.thumbSrc ?? r.src}
            alt=""
            loading="lazy"
            decoding="async"
            width={r.w}
            height={r.h}
            draggable={false}
            style={{ aspectRatio: `${r.w} / ${r.h}` }}
          />
        ) : r.kind === 'image' ? (
          <div className="sr-thumb sr-thumb--ph" style={{ aspectRatio: `${r.w} / ${r.h}`, background: r.color }} />
        ) : r.kind === 'note' ? (
          <div className="sr-card sr-card-note">
            <p className="sr-card-title">{r.title}</p>
            <p className="sr-card-body">{r.body}</p>
          </div>
        ) : (
          <div className="sr-card sr-card-link">
            <LinkIcon size={16} aria-hidden="true" className="sr-card-icon" />
            <p className="sr-card-title">{r.title}</p>
            <p className="sr-card-source">{r.source}</p>
          </div>
        )}
        <StatusOverlay reference={r} />
        <button
          type="button"
          className="sr-add"
          aria-label={`Add ${r.title} to board`}
          onClick={(e) => {
            e.stopPropagation();
            actions.add(r, e.metaKey || e.ctrlKey);
          }}
        >
          <Plus size={14} aria-hidden="true" />
          Add to board
        </button>
      </div>
      <span className="sr-meta-title">{r.title}</span>
    </div>
  );
});
