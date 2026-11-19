// Typed adapter over the Atelier backend HTTP API (see the backend's lib/types.ts).
// Same-origin "/api/..." URLs; in dev the Vite proxy forwards them. The token is read from
// localStorage on every call and is never logged.

export const TOKEN_STORAGE_KEY = 'atelier-token';

export type SaveKind = 'url' | 'image' | 'file' | 'note';
export type SaveStatus = 'accepted' | 'processing' | 'ready' | 'failed';

export interface Save {
  id: string;
  kind: SaveKind;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  previewUrl: string | null;
  asset: { mediaType: string; bytes: number } | null;
  status: SaveStatus;
  error: string | null;
  duplicateOf: string | null;
  /** Visual tags detected by the backend (missing on older backends). */
  tags?: string[];
  createdAt: string;
}

export interface ServerProject { id: string; name: string; createdAt: string; updatedAt: string }
export interface ServerBoard { id: string; camera: { x: number; y: number; zoom: number }; items: { id: string; type: 'save' | 'note'; saveId: string | null; text: string | null; x: number; y: number; w: number; h: number; z: number }[] }

export interface SavesPage {
  saves: Save[];
  next: string | null;
}

/** Every failure of an API call. `status` is 0 when no HTTP response was received. */
export class ApiClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
  }
}

export function isApiError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ClientOptions {
  fetch?: FetchLike;
  getToken?: () => string | null;
}

export function readToken(): string | null {
  try {
    const t = globalThis.localStorage?.getItem(TOKEN_STORAGE_KEY);
    return t ? t : null;
  } catch {
    return null;
  }
}

export function writeToken(token: string | null): void {
  try {
    if (token) globalThis.localStorage?.setItem(TOKEN_STORAGE_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

const FRIENDLY: Record<number, { code: string; message: string }> = {
  413: { code: 'too_large', message: 'That file is too large for the backend (25 MB max).' },
  415: { code: 'unsupported_type', message: "The backend can't store that file type (use PNG, JPEG, GIF or WebP)." },
};

async function errorFromResponse(res: Response): Promise<ApiClientError> {
  const friendly = FRIENDLY[res.status];
  let code = `http_${res.status}`;
  let message = `The backend returned an error (${res.status}).`;
  try {
    const body: unknown = await res.json();
    if (body && typeof body === 'object') {
      const err = (body as { error?: { code?: unknown; message?: unknown } }).error;
      if (err && typeof err.code === 'string') code = err.code;
      if (err && typeof err.message === 'string' && err.message) message = err.message;
    }
  } catch {
    /* not JSON */
  }
  if (res.status === 401 || res.status === 403) {
    code = 'unauthorized';
    message = "The backend didn't accept the access token.";
  }
  if (friendly) return new ApiClientError(friendly.code, friendly.message, res.status);
  return new ApiClientError(code, message, res.status);
}

export function createApiClient(opts: ClientOptions = {}) {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const getToken = opts.getToken ?? readToken;

  async function send(path: string, init: RequestInit, auth: boolean): Promise<Response> {
    const headers = new Headers(init.headers);
    if (auth) {
      const token = getToken();
      if (!token) throw new ApiClientError('no_token', 'Not connected to the backend.', 0);
      headers.set('Authorization', `Bearer ${token}`);
    }
    let res: Response;
    try {
      res = await doFetch(path, { ...init, headers });
    } catch {
      throw new ApiClientError('network_error', "Couldn't reach the backend.", 0);
    }
    return res;
  }

  async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
    const res = await send(path, init, auth);
    if (!res.ok) throw await errorFromResponse(res);
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiClientError('bad_response', 'The backend sent a response we could not read.', res.status);
    }
    const r = body as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    if (r && r.ok === true) return r.data as T;
    if (r && r.ok === false && r.error) {
      throw new ApiClientError(
        typeof r.error.code === 'string' ? r.error.code : 'error',
        typeof r.error.message === 'string' ? r.error.message : 'The backend reported an error.',
        res.status,
      );
    }
    throw new ApiClientError('bad_response', 'The backend sent a response we could not read.', res.status);
  }

  const enc = encodeURIComponent;

  return {
    createProject: (name: string) => call<ServerProject>('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
    listProjects: () => call<{ projects: ServerProject[] }>('/api/projects'),
    getBoard: (id: string) => call<ServerBoard>(`/api/projects/${enc(id)}/board`),
    putBoard: (board: ServerBoard) => call<ServerBoard>(`/api/projects/${enc(board.id)}/board`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(board) }),
    renameProject: (id: string, name: string) => call<ServerProject>(`/api/projects/${enc(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }),
    deleteProject: (id: string) => call<{ id: string }>(`/api/projects/${enc(id)}`, { method: 'DELETE' }),
    health: () => call<{ semantic: boolean }>('/api/health', {}, false),
    listSaves: (limit = 50, cursor?: string) => call<SavesPage>(`/api/saves?limit=${enc(String(limit))}${cursor ? `&cursor=${enc(cursor)}` : ""}`),
    search: (query: string) => call<{ hits: { save: Save }[]; weaker: { save: Save }[]; semantic: boolean }>(`/api/search?q=${enc(query)}`),
    uploadImage(file: File, title?: string, idempotencyKey?: string) {
      const form = new FormData();
      form.append('file', file, file.name);
      if (title) form.append('title', title);
      return call<Save>('/api/saves', { method: 'POST', body: form, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} });
    },
    saveLink: (url: string, title?: string, idempotencyKey?: string) =>
      call<Save>('/api/saves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}) },
        body: JSON.stringify(title ? { url, title } : { url }),
      }),
    getSave: (id: string) => call<Save>(`/api/saves/${enc(id)}`),
    retrySave: (id: string) => call<Save>(`/api/saves/${enc(id)}/retry`, { method: 'POST' }),
    deleteSave: (id: string) => call<{ id: string }>(`/api/saves/${enc(id)}`, { method: 'DELETE' }),
    async fetchAsset(id: string): Promise<Blob> {
      const res = await send(`/api/assets/${enc(id)}`, {}, true);
      if (!res.ok) throw await errorFromResponse(res);
      return res.blob();
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

const defaultClient = createApiClient();
export const createProject = defaultClient.createProject;
export const listProjects = defaultClient.listProjects;
export const getProjectBoard = defaultClient.getBoard;
export const putProjectBoard = defaultClient.putBoard;
export const renameProject = defaultClient.renameProject;
export const deleteProject = defaultClient.deleteProject;
export const health = defaultClient.health;
export const listSaves = defaultClient.listSaves;
export const searchSaves = defaultClient.search;
export const uploadImage = defaultClient.uploadImage;
export const saveLink = defaultClient.saveLink;
export const getSave = defaultClient.getSave;
export const retrySave = defaultClient.retrySave;
export const deleteSave = defaultClient.deleteSave;
export const fetchAsset = defaultClient.fetchAsset;

// Backend connection helpers live in refs/backend.ts; re-exported here per the refs contract.
export { connectBackend, disconnectBackend } from '../refs/backend';
