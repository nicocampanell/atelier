import {
  useCallback,
  useEffect,
  useId,
  useDeferredValue,
  useMemo,
  memo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent as RKeyboardEvent,
} from 'react';
import { Check, ExternalLink, FileText, Link as LinkIcon, Plus, Search, Trash2, X } from 'lucide-react';
import { useReferences } from '../refs/store';
import { filterReferences, tagCounts } from '../search/SearchBar';
import { StatusOverlay } from '../add/StatusOverlay';
import { retry } from '../refs/actions';
import { useFileDrop } from '../add/useFileDrop';
import type { BoardsStore, BoardMeta } from '../state/contracts';
import { REF_DRAG_MIME, type Reference, type ReferenceKind } from '../types';
import './library.css';

type View = 'grid' | 'list';
type KindFilter = 'all' | ReferenceKind;

const VIEW_KEY = 'atelier.library.view.v1';
const KINDS: { id: KindFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'note', label: 'Notes' },
  { id: 'link', label: 'Links' },
];

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

const sourceHref = (source: string): string | null =>
  /^https?:\/\//i.test(source) ? source : source.includes('.') && !/\s/.test(source) ? `https://${source}` : null;

/* ---------- Add to board popover ---------- */

/** The slice of BoardsStore the menus need; a stable object so memoized cards are not invalidated. */
type BoardActions = Pick<BoardsStore, 'addRef' | 'create'>;
const NO_BOARDS: BoardMeta[] = [];
const sameBoards = (a: BoardMeta[], b: BoardMeta[]) => a === b || (a.length === b.length && a.every((x, i) => x === b[i]));

function AddMenu({
  reference,
  actions,
  boards,
  onBoards,
  onOpenBoard,
  onDelete,
  className,
}: {
  reference: Reference;
  actions: BoardActions;
  boards: BoardMeta[];
  /** Boards that already hold this reference. */
  onBoards: BoardMeta[];
  onOpenBoard: (id: string) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [flash, setFlash] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const menuId = useId();
  const containing = new Set(onBoards.map((b) => b.id));

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setCreating(false);
    setName('');
    if (refocus) btnRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const confirm = (id: string) => {
    setFlash(id);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setFlash(null), 1600);
  };

  const add = (b: BoardMeta) => {
    if (containing.has(b.id)) return;
    if (actions.addRef(b.id, reference.id)) confirm(b.id);
  };

  const submitNew = () => {
    const n = name.trim();
    if (!n) return;
    const id = actions.create(n);
    actions.addRef(id, reference.id);
    setCreating(false);
    setName('');
    confirm(id);
  };

  const onKeyDown = (e: RKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next].focus();
  };

  return (
    <div
      ref={wrapRef}
      className={`lib-menu-wrap ${className ?? ''}`}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) close(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className="lib-pill-btn"
        aria-label={`Add ${reference.title} to board`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : setOpen(true))}
      >
        <Plus size={14} aria-hidden="true" />
        <span>Add to board</span>
      </button>
      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label="Add to board" className="lib-menu">
          {boards.map((b) => {
            const has = containing.has(b.id);
            return (
              <div className="lib-menu-row" key={b.id}>
                <button
                  type="button"
                  role="menuitem"
                  className="lib-menu-item"
                  aria-disabled={has || undefined}
                  onClick={() => add(b)}
                >
                  <span className="lib-menu-check">{has && <Check size={14} aria-hidden="true" />}</span>
                  <span className="lib-menu-name">{b.name}</span>
                  {flash === b.id && <span className="lib-menu-flash">Added to {b.name}</span>}
                </button>
                {has && (
                  <button
                    type="button"
                    role="menuitem"
                    className="lib-menu-open"
                    aria-label={`Open ${b.name}`}
                    onClick={() => {
                      close(false);
                      onOpenBoard(b.id);
                    }}
                  >
                    Open
                  </button>
                )}
              </div>
            );
          })}
          {creating ? (
            <div className="lib-menu-new">
              <input
                autoFocus
                className="lib-menu-input"
                value={name}
                placeholder="Board name"
                aria-label="New board name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitNew();
                  }
                }}
              />
            </div>
          ) : (
            <div className="lib-menu-row">
              <button type="button" role="menuitem" className="lib-menu-item" onClick={() => setCreating(true)}>
                <span className="lib-menu-check">
                  <Plus size={14} aria-hidden="true" />
                </span>
                <span className="lib-menu-name">New board…</span>
              </button>
            </div>
          )}
          {reference.userAdded && (
            <>
              <div className="lib-menu-sep" role="separator" />
              <div className="lib-menu-row">
                <button
                  type="button"
                  role="menuitem"
                  className="lib-menu-item lib-menu-item--danger"
                  onClick={() => {
                    close(false);
                    onDelete(reference.id);
                  }}
                >
                  <span className="lib-menu-check">
                    <Trash2 size={14} aria-hidden="true" />
                  </span>
                  <span className="lib-menu-name">Delete reference</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- Shared bits ---------- */

function BoardBadges({ boards }: { boards: BoardMeta[] }) {
  if (!boards.length) return null;
  const shown = boards.slice(0, 2);
  return (
    <span className="lib-badges" aria-label={`On boards: ${boards.map((b) => b.name).join(', ')}`}>
      {shown.map((b) => (
        <span className="lib-badge" key={b.id}>
          {b.name}
        </span>
      ))}
      {boards.length > 2 && <span className="lib-badge lib-badge-more">+{boards.length - 2}</span>}
    </span>
  );
}

function SourceLink({ source }: { source: string }) {
  const href = sourceHref(source);
  if (!href) return null;
  return (
    <a
      className="lib-pill-btn lib-pill-icon"
      href={href}
      target="_blank"
      rel="noopener"
      aria-label={`Open source ${source}`}
      title={`Open ${source}`}
      draggable={false}
    >
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

const onDragStart = (e: DragEvent, ref: Reference) => {
  e.dataTransfer.setData(REF_DRAG_MIME, ref.id);
  e.dataTransfer.effectAllowed = 'copy';
};

interface ItemProps {
  reference: Reference;
  index: number;
  actions: BoardActions;
  boards: BoardMeta[];
  onBoards: BoardMeta[];
  onOpenBoard: (id: string) => void;
  onDelete: (id: string) => void;
}

/** Cards re-render only when their own reference, board badges or menu inputs change. */
const sameItem = (a: ItemProps, b: ItemProps) =>
  a.reference === b.reference && a.index === b.index && a.actions === b.actions && a.onOpenBoard === b.onOpenBoard &&
  a.onDelete === b.onDelete && sameBoards(a.boards, b.boards) && sameBoards(a.onBoards, b.onBoards);

/** Cards past this index are off-screen on load: skip the staggered entrance (and keep their index prop stable). */
const ANIMATED = 40;
const enter = (index: number) => (index < ANIMATED ? { animationDelay: `${Math.min(index * 20, 300)}ms` } : { animation: 'none' });

const Card = memo(function Card({ reference: r, index, actions, boards, onBoards, onOpenBoard, onDelete }: ItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <article
      className={`lib-card${menuOpen ? ' is-menu-open' : ''}`}
      aria-label={`${r.kind}: ${r.title}`}
      draggable
      onDragStart={(e) => onDragStart(e, r)}
      style={enter(index)}
    >
      <div className="lib-media">
        {r.kind === 'image' && (r.thumbSrc ?? r.src) ? (
          <img
            className="lib-img"
            src={r.thumbSrc ?? r.src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            width={r.w}
            height={r.h}
            style={{ aspectRatio: `${r.w} / ${r.h}`, background: r.color }}
          />
        ) : r.kind === 'image' ? (
          <div className="lib-img" style={{ aspectRatio: `${r.w} / ${r.h}`, background: r.color }} />
        ) : r.kind === 'note' ? (
          <div className="lib-mini lib-mini-note">
            <FileText size={16} aria-hidden="true" className="lib-mini-icon" />
            <p>{r.body ?? r.title}</p>
          </div>
        ) : (
          <div className="lib-mini lib-mini-link">
            {(r.thumbSrc ?? r.src) && (
              <img
                className="lib-img lib-mini-thumb"
                src={r.thumbSrc ?? r.src}
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                width={320}
                height={180}
                style={{ background: r.color }}
              />
            )}
            <div className="lib-mini-body">
              <LinkIcon size={14} aria-hidden="true" className="lib-mini-icon" />
              {r.body && <p>{r.body}</p>}
            </div>
          </div>
        )}
        <StatusOverlay reference={r} />
        <div className="lib-actions">
          <SourceLink source={r.url ?? r.source} />
          <AddMenuTracked reference={r} actions={actions} boards={boards} onBoards={onBoards} onOpenBoard={onOpenBoard} onDelete={onDelete} onOpenChange={setMenuOpen} />
        </div>
      </div>
      <div className="lib-meta">
        <div className="lib-meta-text">
          <h3 className="lib-title">{r.title}</h3>
          <p className="lib-source">{r.source}</p>
        </div>
        <BoardBadges boards={onBoards} />
      </div>
    </article>
  );
}, sameItem);

/** AddMenu plus an open-state callback so the card can lift above its neighbours. */
function AddMenuTracked(props: React.ComponentProps<typeof AddMenu> & { onOpenChange: (o: boolean) => void }) {
  const { onOpenChange, ...rest } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new MutationObserver(() => onOpenChange(!!el.querySelector('[role="menu"]')));
    obs.observe(el, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [onOpenChange]);
  return (
    <div ref={wrapRef} className="lib-menu-host">
      <AddMenu {...rest} />
    </div>
  );
}

const Row = memo(function Row({ reference: r, index, actions, boards, onBoards, onOpenBoard, onDelete }: ItemProps) {
  return (
    <article
      className="lib-row"
      aria-label={`${r.kind}: ${r.title}`}
      draggable
      onDragStart={(e) => onDragStart(e, r)}
      style={enter(index)}
    >
      <div className="lib-thumb" style={r.kind === 'image' ? { background: r.color } : undefined}>
        {r.kind === 'image' && (r.thumbSrc ?? r.src) ? (
          <img src={r.thumbSrc ?? r.src} alt="" loading="lazy" decoding="async" draggable={false} width={48} height={48} />
        ) : r.kind === 'note' ? (
          <FileText size={20} aria-hidden="true" />
        ) : (
          <LinkIcon size={20} aria-hidden="true" />
        )}
      </div>
      <div className="lib-row-text">
        <h3 className="lib-title">{r.title}</h3>
        <p className="lib-source">{r.source}</p>
      </div>
      <RowStatus reference={r} />
      <div className="lib-row-tags">
        {r.tags.slice(0, 3).map((t) => (
          <span className="lib-badge" key={t}>
            {t}
          </span>
        ))}
      </div>
      <BoardBadges boards={onBoards} />
      <div className="lib-row-actions">
        <SourceLink source={r.url ?? r.source} />
        <AddMenu reference={r} actions={actions} boards={boards} onBoards={onBoards} onOpenBoard={onOpenBoard} onDelete={onDelete} />
      </div>
    </article>
  );
}, sameItem);

/** Inline save state for list rows (the card overlay does not fit a 48px thumb). */
function RowStatus({ reference: r }: { reference: Reference }) {
  if (!r.userAdded) return null;
  const text = r.status === 'saving' ? 'Saving…' : r.status === 'failed' ? 'Couldn’t save' : r.sync === 'failed' ? 'Not synced' : r.sync === 'syncing' ? 'Syncing…' : null;
  if (!text) return null;
  const bad = r.status === 'failed' || r.sync === 'failed';
  return (
    <span className={bad ? 'lib-status is-bad' : 'lib-status'} role={bad ? undefined : 'status'} title={r.error}>
      {text}
      {bad && (
        <button type="button" className="st-retry" onClick={() => retry(r.id)}>
          Retry
        </button>
      )}
    </span>
  );
}

/* ---------- Page ---------- */

export function LibraryPage({
  store,
  onOpenBoard: openBoard,
  onDelete: deleteRef,
  onFiles,
}: {
  store: BoardsStore;
  onOpenBoard: (id: string) => void;
  onDelete: (id: string) => void;
  /** Files dropped from Finder onto the page. */
  onFiles: (files: File[]) => void;
}) {
  const { list } = useReferences();
  const allTags = useMemo(() => tagCounts(list), [list]);
  const fileDrop = useFileDrop({ accept: () => true, onFiles });
  const [view, setViewState] = useState<View>(readView);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('all');
  const [tags, setTags] = useState<string[]>([]);
  const [boardId, setBoardId] = useState('');
  // The store (and App's callbacks) change identity often; memoized cards get stable wrappers over the latest ones.
  const latest = useRef({ store, openBoard, deleteRef });
  useEffect(() => {
    latest.current = { store, openBoard, deleteRef };
  });
  const actions = useMemo<BoardActions>(
    () => ({ addRef: (b, r) => latest.current.store.addRef(b, r), create: (n) => latest.current.store.create(n) }),
    [],
  );
  const onOpenBoard = useCallback((id: string) => latest.current.openBoard(id), []);
  const onDelete = useCallback((id: string) => latest.current.deleteRef(id), []);
  // refId -> boards holding it, built once per store change (store.boardsContaining per card is O(boards x items)).
  const boardsOf = useMemo(() => {
    const m = new Map<string, BoardMeta[]>();
    for (const b of store.boards) {
      for (const { refId } of store.itemsOf(b.id)) {
        const cur = m.get(refId);
        if (!cur) m.set(refId, [b]);
        else if (cur[cur.length - 1] !== b) cur.push(b);
      }
    }
    return m;
  }, [store]);
  // Typing stays instant; the 1000+ card grid catches up at lower priority.
  const deferredQuery = useDeferredValue(query);

  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const results = useMemo(
    () =>
      filterReferences(deferredQuery, tags, list).filter(
        (r) => (kind === 'all' || r.kind === kind) && (!boardId || boardsOf.get(r.id)?.some((b) => b.id === boardId)),
      ),
    [deferredQuery, tags, list, kind, boardId, boardsOf],
  );
  const filtered = query.trim() !== '' || kind !== 'all' || tags.length > 0 || boardId !== '';
  const clear = () => {
    setQuery('');
    setKind('all');
    setTags([]);
    setBoardId('');
  };
  const toggleTag = (t: string) =>
    setTags((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const boardValid = useMemo(
    () => !boardId || store.boards.some((b) => b.id === boardId),
    [boardId, store.boards],
  );
  useEffect(() => {
    if (!boardValid) setBoardId('');
  }, [boardValid]);

  const total = list.length;
  const countLabel = filtered
    ? `${results.length} of ${total} references`
    : `${total} references`;

  return (
    <main className={fileDrop.active ? 'lib-page is-file-drop' : 'lib-page'} aria-label="Library" {...fileDrop.handlers}>
      <header className="lib-head">
        <h1 className="lib-h1">Library</h1>
        <span className="lib-count" aria-live="polite">
          {countLabel}
        </span>
        <div className="lib-seg" role="group" aria-label="View">
          {(['grid', 'list'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              className="lib-seg-btn"
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >
              {v === 'grid' ? 'Grid' : 'List'}
            </button>
          ))}
        </div>
      </header>

      <div className="lib-filters">
        <label className="lib-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="text"
            value={query}
            placeholder="Filter library"
            aria-label="Filter library"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="lib-search-clear" aria-label="Clear filter" onClick={() => setQuery('')}>
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </label>
        <div className="lib-chip-row">
          <div className="lib-chips" role="group" aria-label="Kind">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="lib-chip"
                data-active={kind === k.id || undefined}
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="lib-chip lib-select">
            <span className="visually-hidden">Board</span>
            <select
              value={boardId}
              aria-label="Board"
              onChange={(e) => setBoardId(e.target.value)}
            >
              <option value="">All boards</option>
              {store.boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="lib-tags" role="group" aria-label="Tags">
          {allTags.map(({ tag, count }) => (
            <button
              key={tag}
              type="button"
              className="lib-chip lib-tag"
              data-active={tags.includes(tag) || undefined}
              aria-pressed={tags.includes(tag)}
              onClick={() => toggleTag(tag)}
            >
              {tag}
              <span className="lib-tag-count">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {results.length === 0 ? (
        <div className="lib-empty">
          <p>Nothing matches these filters</p>
          <button type="button" className="lib-clear" onClick={clear}>
            Clear filters
          </button>
        </div>
      ) : view === 'grid' ? (
        <div className="lib-grid">
          {results.map((r, i) => (
            <Card key={r.id} reference={r} index={Math.min(i, ANIMATED)} actions={actions} boards={store.boards} onBoards={boardsOf.get(r.id) ?? NO_BOARDS} onOpenBoard={onOpenBoard} onDelete={onDelete} />
          ))}
        </div>
      ) : (
        <div className="lib-list">
          {results.map((r, i) => (
            <Row key={r.id} reference={r} index={Math.min(i, ANIMATED)} actions={actions} boards={store.boards} onBoards={boardsOf.get(r.id) ?? NO_BOARDS} onOpenBoard={onOpenBoard} onDelete={onDelete} />
          ))}
        </div>
      )}
    </main>
  );
}
