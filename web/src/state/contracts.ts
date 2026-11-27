// Shared contracts for multiple boards, routing and the library page.
// Implemented in src/state/boards.ts and src/state/route.ts. Change only via the orchestrator.

import type { BoardItem, Camera } from '../types';

/** One board's metadata. Its items live in the store, keyed by board id. */
export interface BoardMeta {
  id: string;
  name: string;
  /** Set for a board nested in another: it shows as a card on the parent, not on the overview. */
  parentId?: string;
  /** Server project ID for a board created locally while connected. */
  serverId?: string;
  serverPending?: boolean;
  /** Tile position on the boards overview canvas: world px, top-left of the tile. */
  x: number;
  y: number;
  /** Last camera inside the board; restored when the board is entered. null = fit content. */
  camera: Camera | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * The boards overview's own items ("main area"): free cards that sit beside the board tiles.
 * Items live in the store under this id like any board's (itemsOf / addRef / useBoard work with it),
 * but it has no BoardMeta, so it never appears in `boards`, the overview tiles or the library's board lists.
 */
export const MAIN_ID = 'main';

/** Overview tile size in world px (the tile's outer frame). */
export const BOARD_TILE_W = 360;
export const BOARD_TILE_H = 300;

/** A board item together with the board that holds it (used to remove and restore a reference's blocks). */
export interface PlacedItem {
  boardId: string;
  item: BoardItem;
}

export interface BoardsStore {
  /** In display order. */
  boards: BoardMeta[];
  /** Board most recently entered (fallback target for search/library actions). null if none. */
  lastOpenedId: string | null;
  itemsOf(boardId: string): BoardItem[];
  /** Creates an empty board, placed at the next free overview grid slot. Returns its id. */
  create(name: string): string;
  /**
   * Moves items (and any folders among them) from one board into another; a folder can't enter itself or its own contents.
   * They land right of the target's content, or with their top-left at `at` when given.
   */
  moveItems(fromId: string, itemIds: string[], toId: string, at?: { x: number; y: number }): void;
  /** Creates an empty board nested in `parentId` and places its card centred at world point `at` on the parent. Returns its id. */
  createChild(parentId: string, at: { x: number; y: number }, name?: string): string;
  rename(boardId: string, name: string): void;
  /** Deletes the board and its items. */
  remove(boardId: string): void;
  /** Moves an overview tile (world px delta). */
  moveTile(boardId: string, dx: number, dy: number): void;
  setCamera(boardId: string, camera: Camera): void;
  markOpened(boardId: string): void;
  /**
   * Adds a reference to a board without needing a camera: it is placed in free space
   * to the right of the board's existing content (or at the origin when empty).
   * Returns the new item id, or null if the reference or board does not exist.
   */
  addRef(boardId: string, refId: string): string | null;
  /** Which boards contain this reference (for library badges). */
  boardsContaining(refId: string): BoardMeta[];
  /** Removes every block of this reference from every board. Returns what was removed (for undo). */
  removeItemsOfRef(refId: string): PlacedItem[];
  /** Puts items returned by removeItemsOfRef back (boards that no longer exist are skipped). */
  restoreItems(entries: PlacedItem[]): void;
}

/*
 * Hooks (src/state/boards.ts):
 *   export function useBoards(): BoardsStore
 *     Persisted to localStorage "atelier.boards.v1" (debounced, try/catch).
 *     Migrates items from the legacy single board "atelier.board.v1" into "Moodboard".
 *     Starts with an empty canvas when nothing is stored.
 *   export function useBoard(store: BoardsStore, boardId: string): Board
 *     Returns the existing `Board` interface from src/state/board.ts (items, selected, add, move,
 *     remove, duplicate, bringToFront, select, replace, append) bound to that board's items.
 *     Selection is local UI state, reset when boardId changes.
 *
 * Routing (src/state/route.ts), hash based:
 *   export type Route = { name: 'boards' } | { name: 'board'; id: string } | { name: 'library' };
 *   export function parseRoute(hash: string): Route   // '' | '#/' | unknown -> boards
 *   export function formatRoute(route: Route): string // '#/boards', '#/boards/<id>', '#/library'
 *   export function useRoute(): [Route, (next: Route) => void]  // listens to hashchange
 */
