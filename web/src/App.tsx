import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { isTypingTarget, useCamera } from './canvas/useCamera';
import { useViewBoard } from './state/board';
import { useBoard, useBoards } from './state/boards';
import { MAIN_ID } from './state/contracts';
import { useRoute } from './state/route';
import { useSearchView } from './state/searchView';
import { SearchBar } from './search/SearchBar';
import { ThemeToggle } from './theme/ThemeToggle';
import { LibraryPage } from './library/LibraryPage';
import { BoardBar } from './boards/BoardBar';
import { AddMenu } from './add/AddMenu';
import { ConnectDialog } from './add/ConnectDialog';
import { LinkDialog } from './add/LinkDialog';
import { ToastStack, useToasts } from './add/UndoToast';
import { useAddActions, type Point } from './add/useAddActions';
import { useFileDropGuard } from './add/useFileDrop';
import { useFilePicker } from './add/useFilePicker';
import { usePaste } from './add/usePaste';
import { useBackendStatus } from './refs/backend';
import { tileFieldItem } from './boards/geometry';
import { useBoardTransitions, useCameraSave } from './boards/useBoardTransitions';
import { useFolderTransition } from './boards/useFolderTransition';
import type { Reference } from './types';

const STACK_STEP = 24;
const NOTICE_MS = 2400;

interface PendingShow {
  id: string;
  refs: Reference[];
  label: string;
}

export default function App() {
  const store = useBoards();
  const [route, setRoute] = useRoute();
  const viewBoard = useViewBoard();
  const layerRef = useRef<HTMLDivElement | null>(null);
  const lastBoard = useRef<string | null>(null);
  const pendingShow = useRef<PendingShow | null>(null);
  const beforeExit = useRef<() => void>(() => {});
  const viewActiveRef = useRef(false);
  const liveRef = useRef<ReturnType<typeof useBoard> | null>(null);
  const camera = useCamera({
    onEmptyClick: (additive) => !additive && liveRef.current?.select([], false),
    claimEmptyDrag: () => routeRef.current.name !== 'library',
  });

  const tr = useBoardTransitions({
    camera,
    store,
    route,
    setRoute,
    layerRef,
    beforeExit: () => beforeExit.current(),
  });
  const folder = useFolderTransition({ camera, store, route, setRoute });
  const { t } = tr;
  const busy = t !== null || folder.busy;

  // The board bound to the canvas: the routed one, the one in transition, or the last one visited.
  const exists = (id: string | null | undefined): id is string => !!id && store.boards.some((b) => b.id === id);
  const routed = route.name === 'board' ? route.id : null;
  const activeId = [routed, t?.id, lastBoard.current, store.lastOpenedId, store.boards[0]?.id].find(exists) ?? '';
  useEffect(() => {
    if (routed && exists(routed)) lastBoard.current = routed;
  });
  const board = useBoard(store, activeId);
  const mainBoard = useBoard(store, MAIN_ID);
  const activeMeta = store.boards.find((b) => b.id === activeId);

  const { view, leaving, show, done, keep, keepItems } = useSearchView(board, viewBoard, camera);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  const live = view ? viewBoard : route.name === 'board' ? board : mainBoard;
  const tRef = useRef(t);
  const routeRef = useRef(route);
  useEffect(() => {
    viewActiveRef.current = view !== null;
    liveRef.current = live;
    searchOpenRef.current = searchOpen;
    beforeExit.current = () => {
      if (viewActiveRef.current) done();
    };
    tRef.current = t;
    routeRef.current = route;
  });

  // Which layers are on screen. Transitions override the route while they run.
  const showBoard = t ? (t.kind === 'enter' ? t.stage === 'swap' : t.stage !== 'out') : route.name === 'board';
  const showOverview = t ? (t.kind === 'enter' ? true : t.stage !== 'fit') : route.name === 'boards';
  const boardFade: 'in' | 'out' | null = folder.fade ?? (t?.stage === 'swap' ? (t.kind === 'enter' ? 'in' : 'out') : null);
  const overviewFade: 'in' | 'out' | null = t?.stage === 'swap' ? (t.kind === 'enter' ? 'out' : 'in') : null;
  const focusing = !!t && !(t.kind === 'exit' && t.stage === 'out');

  // Unknown board id: back to the overview.
  useEffect(() => {
    if (route.name === 'board' && !t && !exists(route.id)) setRoute({ name: 'boards' });
  });
  // A search view never outlives its board.
  useEffect(() => {
    if (route.name !== 'board' && viewActiveRef.current) done();
  }, [route.name, done]);

  useCameraSave(camera, store, route.name === 'board' ? route.id : null, route.name === 'board' && !t && !folder.busy, () => !viewActiveRef.current);

  /* ---------- toast ---------- */
  const { toasts, push, remove } = useToasts();
  useEffect(() => {
    const onError = () => push({ text: 'Board changes are saved locally. Server sync will retry.', kind: 'error' });
    window.addEventListener('atelier-board-sync-error', onError);
    return () => window.removeEventListener('atelier-board-sync-error', onError);
  }, [push]);
  const toastApi = useMemo(() => ({ push }), [push]);
  const notify = (text: string, boardId?: string) =>
    push({ text, ms: NOTICE_MS, actions: boardId ? [{ label: 'Open', run: () => openBoard(boardId) }] : undefined });

  /* ---------- adding references ---------- */
  const add = useAddActions({ store, live, camera, inBoard: route.name === 'board' && !busy, toasts: toastApi });
  const [dialog, setDialog] = useState<'link' | 'connect' | null>(null);
  const backend = useBackendStatus();
  // Right-click adds land where the menu was opened; header and shortcut adds clear it.
  const [ctxMenu, setCtxMenu] = useState<{ client: Point; world: Point } | null>(null);
  const addAt = useRef<Point | undefined>(undefined);
  const picker = useFilePicker((files) => add.addFiles(files, addAt.current && { type: 'board', at: addAt.current }));
  const pickFiles = picker.open;
  const openPicker = useCallback(
    (at?: Point) => {
      addAt.current = at;
      pickFiles();
    },
    [pickFiles],
  );
  const openLink = useCallback((at?: Point) => {
    addAt.current = at;
    setDialog('link');
  }, []);
  useFileDropGuard();
  usePaste({ onFiles: (files) => add.addFiles(files), onLink: add.addPastedLink });

  /* ---------- navigation ---------- */
  const openBoard = useCallback(
    (id: string) => {
      if (tRef.current) return;
      if (routeRef.current.name === 'boards' && tr.enter(id)) return;
      setRoute({ name: 'board', id });
    },
    [tr, setRoute],
  );
  /** Out of a board: a nested one returns to its parent, a top-level one zooms out to the overview. */
  const leaveBoard = () => {
    if (!folder.rise()) tr.exit();
  };
  const leaveBoardRef = useRef(leaveBoard);
  useEffect(() => {
    leaveBoardRef.current = leaveBoard;
  });
  const goBoards = () => {
    if (busy) return;
    if (route.name === 'board') tr.exit();
    else setRoute({ name: 'boards' });
  };
  const goLibrary = () => {
    if (busy) return;
    setRoute({ name: 'library' });
  };

  /* ---------- keys ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && !isTypingTarget(e.target) && !document.querySelector('[aria-modal="true"]')) {
        const act = e.code === 'KeyU' ? openPicker : e.code === 'KeyL' ? openLink : e.code === 'KeyN' ? add.newNote : null;
        if (act) {
          e.preventDefault();
          act();
          return;
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      } else if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape' && !searchOpenRef.current && !isTypingTarget(e.target)) {
        if (viewActiveRef.current) done();
        else if (routeRef.current.name === 'board' && !tRef.current && !(liveRef.current?.selected.size ?? 0)) leaveBoardRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [done, tr, openPicker, openLink, add.newNote]);

  /* ---------- search ---------- */
  const targetBoard = (): string | null => {
    const id = [store.lastOpenedId, store.boards[0]?.id].find(exists);
    return id ?? null;
  };

  // Drop at the visible center, stepping diagonally so repeats never stack exactly.
  const onAdd = useCallback(
    (ref: Reference) => {
      if (busy) return;
      if (route.name === 'board') {
        const c = camera.center();
        let { x, y } = c;
        const taken = (px: number, py: number) =>
          live.items.some((i) => Math.hypot(i.x + i.w / 2 - px, i.y + i.h / 2 - py) < 12);
        while (taken(x, y)) {
          x += STACK_STEP;
          y += STACK_STEP;
        }
        // While results are on the canvas, additions join them (the board is dimmed underneath).
        live.add(ref.id, x, y);
      } else {
        const id = targetBoard();
        if (!id) return notify('Create a board first');
        store.addRef(id, ref.id);
        notify(`Added to ${store.boards.find((b) => b.id === id)?.name || 'Untitled board'}`, id);
      }
      setSearchOpen(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [live, camera, route.name, busy, store],
  );

  const onShowResults = useCallback(
    (refs: Reference[], label: string) => {
      if (busy) return;
      if (route.name === 'board') return show(refs, label);
      const id = targetBoard();
      if (!id) return notify('Create a board first');
      pendingShow.current = { id, refs, label };
      openBoard(id);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, route.name, show, openBoard, store],
  );

  // Run a deferred "Show on canvas" once its board is mounted and settled.
  useEffect(() => {
    const p = pendingShow.current;
    if (!p || t || route.name !== 'board' || route.id !== p.id) return;
    pendingShow.current = null;
    show(p.refs, p.label);
  });

  /* ---------- overview / bottom bar props ---------- */
  const overview = useMemo(
    () =>
      showOverview
        ? {
            store,
            layerRef,
            focusId: t?.id ?? null,
            focusing,
            fade: overviewFade,
            inert: busy,
            onOpen: openBoard,
            onFilesToBoard: (boardId: string, files: File[]) => add.addFiles(files, { type: 'tile', boardId }),
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [showOverview, store, t?.id, focusing, overviewFade, busy, openBoard, add.addFiles],
  );
  const tileItems = useMemo(() => store.boards.filter((b) => !b.parentId).map((b) => tileFieldItem(b.id, b)), [store.boards]);
  const subBoard = (id: string) => {
    const meta = store.boards.find((b) => b.id === id);
    return meta && { name: meta.name, items: store.itemsOf(id) };
  };
  const parentMeta = activeMeta?.parentId ? store.boards.find((b) => b.id === activeMeta.parentId) : undefined;

  const barShown = t ? t.kind === 'exit' && t.stage !== 'out' : route.name === 'board';
  const bottom =
    barShown && activeMeta ? (
      <BoardBar
        name={activeMeta.name}
        count={board.items.length}
        closing={busy}
        backLabel={parentMeta ? parentMeta.name || 'Untitled board' : undefined}
        onBack={leaveBoard}
        onRename={(name) => store.rename(activeMeta.id, name)}
      />
    ) : null;

  const nav = (active: boolean) => (active ? 'app-header__link is-active' : 'app-header__link');

  return (
    <>
      <header className="app-header">
        <div className="app-header__left">
          <nav className="app-header__nav" aria-label="Primary" data-active={route.name === 'library' ? 'library' : 'boards'} inert={busy || undefined}>
            <button type="button" className={nav(route.name !== 'library')} aria-current={route.name !== 'library' ? 'page' : undefined} onClick={goBoards}>
              Boards
            </button>
            <button type="button" className={nav(route.name === 'library')} aria-current={route.name === 'library' ? 'page' : undefined} onClick={goLibrary}>
              Library
            </button>
          </nav>
        </div>
        <div className="app-header__center" inert={busy || undefined}>
          <SearchBar open={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} onAdd={onAdd} onShowResults={onShowResults} />
        </div>
        <div className="app-header__right">
          <ThemeToggle />
        </div>
      </header>
      <Canvas
        board={board}
        main={mainBoard}
        camera={camera}
        search={{
          board: viewBoard,
          view,
          leaving,
          onKeep: keep,
          onKeepItems: (ids) => {
            const n = keepItems(ids);
            if (n) push({ text: n === 1 ? 'Added to board' : `Added ${n} to board`, ms: NOTICE_MS });
          },
          onDone: done,
        }}
        showBoard={showBoard}
        boardFade={boardFade}
        overview={overview}
        tileItems={tileItems}
        busy={busy}
        covered={route.name === 'library'}
        bottom={bottom}
        onFiles={(files, at) => add.addFiles(files, at ? { type: 'board', at } : { type: 'library' })}
        editingItemId={add.editingItemId}
        onEditNote={add.editItem}
        onEditDone={add.stopEditing}
        onDeleteRefs={add.deleteRefs}
        onAddAt={(client, world) => setCtxMenu({ client, world })}
        subBoard={subBoard}
        onEnterBoard={(id) => !busy && folder.dive(id)}
        onMoveToBoard={(ids, to, at) => {
          const from = route.name === 'board' ? activeMeta?.id : MAIN_ID;
          if (!from) return;
          store.moveItems(from, ids, to);
          const name = store.boards.find((b) => b.id === to)?.name || 'Untitled board';
          push({ text: `Moved ${ids.length} into “${name}”`, ms: NOTICE_MS, actions: [{ label: 'Undo', run: () => store.moveItems(to, ids, from, at) }] });
        }}
        onRemoveBoards={(ids) => {
          const full = ids.filter((id) => store.itemsOf(id).length);
          const names = full.map((id) => `“${store.boards.find((b) => b.id === id)?.name || 'Untitled board'}”`).join(', ');
          if (full.length && !window.confirm(`Delete ${names} and everything in it? This can’t be undone.`)) return;
          ids.forEach((id) => store.remove(id));
        }}
      />
      {ctxMenu && (
        <AddMenu
          status={backend}
          at={ctxMenu.client}
          onClose={() => setCtxMenu(null)}
          onUpload={() => openPicker(ctxMenu.world)}
          onLink={() => openLink(ctxMenu.world)}
          onNote={() => add.newNote(ctxMenu.world)}
          onBoard={() => (routeRef.current.name === 'board' ? activeMeta && store.createChild(activeMeta.id, ctxMenu.world) : store.create(''))}
          onConnect={() => setDialog('connect')}
        />
      )}
      {route.name === 'library' && (
        <LibraryPage
          store={store}
          onOpenBoard={openBoard}
          onDelete={(id) => add.deleteRefs([id])}
          onFiles={(files) => add.addFiles(files, { type: 'tile', boardId: MAIN_ID })}
        />
      )}
      {picker.input}
      {dialog === 'link' && <LinkDialog onSubmit={(url) => add.addLinkUrl(url, addAt.current)} onClose={() => setDialog(null)} />}
      {dialog === 'connect' && <ConnectDialog onClose={() => setDialog(null)} />}
      <ToastStack toasts={toasts} onDone={remove} />
    </>
  );
}
