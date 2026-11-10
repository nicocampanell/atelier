// Shared contracts between the front end, the API, search and the browser extension.
// Capture shapes are adapted from Pond's packages/schema/src/capture.ts (MIT).
// Change this file only through the orchestrator.

/** What a save is. */
export type SaveKind = "url" | "image" | "file" | "note";

/** Truthful lifecycle. "accepted" means durably stored, NOT that processing is done. */
export type SaveStatus = "accepted" | "processing" | "ready" | "failed";

export interface Save {
  id: string;
  kind: SaveKind;
  /** Original page or image URL, when there is one. */
  sourceUrl: string | null;
  title: string;
  description: string | null;
  /** Preview image URL (served by the API for uploads, remote or null for links). */
  previewUrl: string | null;
  /** Upload metadata for kind "image" | "file". */
  asset: { mediaType: string; bytes: number } | null;
  status: SaveStatus;
  /** Human-readable reason when status is "failed". */
  error: string | null;
  /** True when the same source URL was already saved. */
  duplicateOf: string | null;
  createdAt: string; // ISO
}

/** Block placed on the canvas. Coordinates are in canvas space. */
export interface BoardItem {
  id: string;
  type: "save" | "note";
  saveId: string | null; // set when type is "save"
  text: string | null; // set when type is "note"
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface Board {
  id: string;
  items: BoardItem[];
  /** Saved camera so the view survives reloads. */
  camera: { x: number; y: number; zoom: number };
}

/** One search hit: a save plus where inside it the match is. */
export interface SearchHit {
  save: Save;
  score: number;
  /** "meaning" | "words" | "both" — why it matched. */
  matchedBy: "meaning" | "words" | "both";
  /** Where inside the save the best match sits (page, second, or chunk). */
  location: { kind: "page" | "second" | "chunk"; start: number; end?: number } | null;
  excerpt: string | null;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  /** Hits that scored under half the top score, shown folded. */
  weaker: SearchHit[];
  /** False when no embedding key is set, so only keywords were used. */
  semantic: boolean;
}

/** Standard envelope for every API response. */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

/*
 * HTTP API (all routes require "Authorization: Bearer <ATELIER_TOKEN>"
 * except GET /api/health):
 *
 * GET    /api/health                      -> ApiResult<{ semantic: boolean }>
 * GET    /api/saves?limit=&cursor=        -> ApiResult<{ saves: Save[]; next: string | null }>  (newest first)
 * POST   /api/saves   JSON {url, title?, note?}      -> ApiResult<Save>   (202-style: status "accepted")
 * POST   /api/saves   multipart file=<File>, title?  -> ApiResult<Save>
 * GET    /api/saves/:id                   -> ApiResult<Save>
 * DELETE /api/saves/:id                   -> ApiResult<{ id: string }>
 * POST   /api/saves/:id/retry             -> ApiResult<Save>
 * GET    /api/assets/:id                  -> raw file (authenticated; also accepts ?token= for <img> tags)
 * GET    /api/search?q=&kinds=            -> ApiResult<SearchResponse>
 * GET    /api/board                       -> ApiResult<Board>
 * PUT    /api/board   Board               -> ApiResult<Board>
 */
