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
  /** Visual tags detected in the image (empty when none or not tagged yet). */
  tags: string[];
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
  /** True when semantic relevance scoring succeeded for this search. */
  semantic: boolean;
}

/**
 * A project is a named board. Every user has at least one; the oldest is the
 * "default project" that the legacy /api/board routes read and write.
 */
export interface Project {
  id: string;
  name: string;
  /** Live items on the board (items pointing at deleted saves are not counted). */
  itemCount: number;
  /** Preview of the most recently placed save with a preview, or null. */
  coverUrl: string | null;
  createdAt: string; // ISO
  updatedAt: string; // ISO; bumped on rename, board PUT, and placement
}

/** Response of POST /api/saves. `placedIn` is set when a projectId was sent and placement succeeded. */
export type SaveCreated = Save & {
  placedIn: { projectId: string; itemId: string } | null;
};

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
 * POST   /api/saves   JSON {url, title?, note?, projectId?}                 -> ApiResult<SaveCreated> (202-style: status "accepted")
 * POST   /api/saves   multipart file=<File>, title?, sourceUrl?, projectId? -> ApiResult<SaveCreated>
 *          sourceUrl: page or image URL the upload came from (stored as Save.sourceUrl; must pass
 *          the same public-http(s) check as JSON urls, but is never fetched for uploads).
 *          projectId: place the new save on that project's board in free space to the right of
 *          existing content. Unknown/foreign projectId -> 404 "project_not_found" and NOTHING is saved.
 *          Header "Idempotency-Key: <uuid>" (optional, <=200 chars): a repeat POST with the same key
 *          for the same user within 24h returns the original SaveCreated (status 200) and creates nothing.
 *          Duplicate URLs still create a new save with duplicateOf set (unchanged behaviour).
 *
 * GET    /api/projects                    -> ApiResult<{ projects: Project[] }>  (updatedAt desc; creates the default project if none)
 * POST   /api/projects JSON {name}        -> ApiResult<Project>  (name trimmed, 1..120 chars)
 * PATCH  /api/projects/:id JSON {name}    -> ApiResult<Project>
 * DELETE /api/projects/:id                -> ApiResult<{ id: string }>  (deletes board items, never saves;
 *                                            deleting the last project is refused 409 "last_project")
 * GET    /api/projects/:id/board          -> ApiResult<Board>  (Board.id === project id)
 * PUT    /api/projects/:id/board  Board   -> ApiResult<Board>
 * GET    /api/saves/:id                   -> ApiResult<Save>
 * DELETE /api/saves/:id                   -> ApiResult<{ id: string }>
 * POST   /api/saves/:id/retry             -> ApiResult<Save>
 * GET    /api/assets/:id                  -> raw file (authenticated; also accepts ?token= for <img> tags)
 * GET    /api/search?q=&kinds=            -> ApiResult<SearchResponse>
 * GET    /api/board                       -> ApiResult<Board>   (the default project's board; kept for compatibility)
 * PUT    /api/board   Board               -> ApiResult<Board>
 *
 * CORS: routes answer OPTIONS preflight and send Access-Control-Allow-Origin for origins listed in
 * ATELIER_ALLOWED_ORIGINS (comma-separated, e.g. "chrome-extension://<id>,http://localhost:5173").
 * The extension's background worker uses host_permissions and does not need CORS, but the popup may.
 */
