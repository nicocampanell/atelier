// Shared contracts between the canvas and search modules. Do not change shapes
// without updating both sides.

export type ReferenceKind = 'image' | 'note' | 'link';

/** Lifecycle of a user-added reference. Seed references have no status. */
export type ReferenceStatus = 'saving' | 'ready' | 'failed';

/**
 * Whether a user-added image/link is stored on the backend:
 * local (no backend in use), syncing (in flight), synced, failed (backend rejected or unreachable).
 */
export type SyncState = 'local' | 'syncing' | 'synced' | 'failed';

export interface Reference {
  id: string;
  kind: ReferenceKind;
  title: string;
  /** Human-readable origin, e.g. "are.na", "x.com/@studio", "Screenshot". */
  source: string;
  tags: string[];
  /** Dominant color, used for placeholders while images load. */
  color: string;
  /** Image URL (image + link kinds). Notes have none. */
  src?: string;
  /** Body text for notes; short description for links. */
  body?: string;
  /** Natural size in world px at zoom 1. Preserve aspect ratio for images. */
  w: number;
  h: number;

  /* ---- Optional fields for references the user added (all absent on seeds) ---- */
  status?: ReferenceStatus;
  /** Human-readable reason when status is "failed", or why a sync failed. */
  error?: string;
  sync?: SyncState;
  /** Id of the matching Save on the backend. */
  serverId?: string;
  /** Small image (max 640 px) for library and search tiles; falls back to `src`. */
  thumbSrc?: string;
  /** Original URL of a link reference. */
  url?: string;
  userAdded?: boolean;
}

export interface BoardItem {
  /** Unique per placement (the same reference may be placed twice). */
  id: string;
  /** '' when the item is a sub-board card (see boardId). */
  refId: string;
  /** Set when the item is a card for a child board (BoardMeta.parentId = the board holding it). */
  boardId?: string;
  /** World coordinates of the top-left corner. */
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

/** React Flow semantics: world (wx, wy) draws at (wx*zoom + x, wy*zoom + y) px from the canvas root. */
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** MIME type used for HTML5 drag from search results onto the canvas. Payload = Reference.id */
export const REF_DRAG_MIME = 'application/x-atelier-ref';
