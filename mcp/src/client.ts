import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { inspectImage } from "./media.js";

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: { code: string; message: string } };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export interface Project {
  id: string;
  name: string;
  itemCount: number;
  coverUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface BoardItem {
  id: string;
  type: "save" | "note";
  saveId: string | null;
  text: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface Board {
  id: string;
  items: BoardItem[];
  camera: { x: number; y: number; zoom: number };
}

export interface Save {
  id: string;
  kind: string;
  sourceUrl: string | null;
  title: string;
  description: string | null;
  previewUrl: string | null;
  asset: { mediaType: string; bytes: number } | null;
  status: string;
  error: string | null;
  duplicateOf: string | null;
  tags: string[];
  createdAt: string;
}

export interface SearchHit {
  save: Save;
  score: number;
  matchedBy: "meaning" | "words" | "both";
  location: { kind: string; start: number; end?: number } | null;
  excerpt: string | null;
}

export interface SearchResponse {
  query: string;
  hits: SearchHit[];
  weaker: SearchHit[];
  semantic: boolean;
}

export interface AtelierConfig {
  apiUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  email: string;
  password: string;
}

export function loadConfig(): AtelierConfig {
  const apiUrl = (process.env.ATELIER_URL ?? "").trim().replace(/\/+$/, "");
  const supabaseUrl = (process.env.SUPABASE_URL ?? process.env.ATELIER_SUPABASE_URL ?? "").trim();
  const supabaseAnonKey = (process.env.SUPABASE_ANON_KEY ?? process.env.ATELIER_SUPABASE_ANON_KEY ?? "").trim();
  const email = (process.env.ATELIER_EMAIL ?? "").trim();
  const password = process.env.ATELIER_PASSWORD ?? "";
  const missing = [
    !apiUrl && "ATELIER_URL",
    !supabaseUrl && "SUPABASE_URL (or ATELIER_SUPABASE_URL)",
    !supabaseAnonKey && "SUPABASE_ANON_KEY (or ATELIER_SUPABASE_ANON_KEY)",
    !email && "ATELIER_EMAIL",
    !password && "ATELIER_PASSWORD",
  ].filter(Boolean);
  if (missing.length) {
    throw new Error(`Atelier MCP missing env: ${missing.join(", ")}`);
  }
  return { apiUrl, supabaseUrl, supabaseAnonKey, email, password };
}

export class AtelierClient {
  private session: Session | null = null;
  private readonly supabase: SupabaseClient;

  constructor(private readonly cfg: AtelierConfig) {
    this.supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private async ensureSession(): Promise<Session> {
    if (this.session?.access_token) {
      const exp = this.session.expires_at ?? 0;
      if (exp * 1000 > Date.now() + 60_000) return this.session;
      if (this.session.refresh_token) {
        const { data, error } = await this.supabase.auth.refreshSession({
          refresh_token: this.session.refresh_token,
        });
        if (!error && data.session) {
          this.session = data.session;
          return this.session;
        }
      }
    }
    const { data, error } = await this.supabase.auth.signInWithPassword({
      email: this.cfg.email,
      password: this.cfg.password,
    });
    if (error || !data.session) {
      throw new Error(error?.message ?? "Sign-in failed (check ATELIER_EMAIL / ATELIER_PASSWORD and owner allowlist).");
    }
    this.session = data.session;
    return this.session;
  }

  async api<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
    const session = await this.ensureSession();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${session.access_token}`);
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    let res: Response;
    try {
      res = await fetch(this.cfg.apiUrl + path, { ...init, headers, cache: "no-store" });
    } catch (e) {
      throw new Error(`Can't reach Atelier at ${this.cfg.apiUrl}: ${e instanceof Error ? e.message : "network error"}`);
    }
    if (res.status === 401 && !retried) {
      this.session = null;
      return this.api(path, init, true);
    }
    let parsed: ApiResult<T> | null = null;
    try {
      parsed = (await res.json()) as ApiResult<T>;
    } catch {
      throw new Error(`Atelier ${path} returned non-JSON (${res.status})`);
    }
    if (!parsed.ok) {
      throw new Error(parsed.error?.message ?? `Atelier ${path} failed (${res.status})`);
    }
    return parsed.data;
  }

  listProjects() {
    return this.api<{ projects: Project[] }>("/api/projects");
  }

  getBoard(projectId: string) {
    return this.api<Board>(`/api/projects/${encodeURIComponent(projectId)}/board`);
  }

  getSave(id: string) {
    return this.api<Save>(`/api/saves/${encodeURIComponent(id)}`);
  }

  async getSaveBySourceUrl(sourceUrl: string): Promise<Save> {
    const params = new URLSearchParams({ limit: "100", sourceUrl });
    let result = await this.api<{ saves: Save[]; next: string | null; exactSource?: boolean }>(`/api/saves?${params}`);
    const matches: Save[] = [];
    const seen = new Set<string>();
    // Older deployments ignore sourceUrl. Reuse their first page and scan subsequent pages.
    for (let page = 0; page < 100; page++) {
      matches.push(...result.saves.filter((save) => save.sourceUrl === sourceUrl));
      if (result.exactSource === true || !result.next) {
        if (matches.length === 0) throw new Error("No saved reference has that exact source URL.");
        if (matches.length > 1) throw new Error(`Multiple saved references have that source URL. Use a save ID: ${matches.map((save) => save.id).join(", ")}`);
        return this.getSave(matches[0]!.id);
      }
      if (seen.has(result.next)) throw new Error("Atelier returned a repeated pagination cursor while resolving the source URL.");
      seen.add(result.next);
      const nextParams = new URLSearchParams({ limit: "100", cursor: result.next });
      result = await this.api(`/api/saves?${nextParams}`);
    }
    throw new Error("The saved reference scan reached its 10,000 item limit. Use a save ID instead.");
  }

  async inspectSaveImage(save: Save) {
    const session = await this.ensureSession();
    const image = await inspectImage(save.previewUrl, save.id, this.cfg.apiUrl, this.cfg.supabaseUrl, session.access_token);
    if (image.status === "unavailable" && image.httpStatus === 401) {
      this.session = null;
      const renewed = await this.ensureSession();
      return inspectImage(save.previewUrl, save.id, this.cfg.apiUrl, this.cfg.supabaseUrl, renewed.access_token);
    }
    return image;
  }

  async getSaves(ids: string[]): Promise<Map<string, Save>> {
    const out = new Map<string, Save>();
    // ponytail: sequential fetches; batch endpoint if boards routinely exceed ~50 saves
    for (const id of ids) {
      try {
        out.set(id, await this.getSave(id));
      } catch {
        // missing/deleted save — board GET already drops some; skip quietly
      }
    }
    return out;
  }

  search(q: string, kinds?: string[]) {
    const sp = new URLSearchParams({ q });
    if (kinds?.length) sp.set("kinds", kinds.join(","));
    return this.api<SearchResponse>(`/api/search?${sp}`);
  }

  /** Resolve project by id or case-insensitive name. */
  async resolveProject(idOrName: string): Promise<Project> {
    const { projects } = await this.listProjects();
    const key = idOrName.trim();
    const byId = projects.find((p) => p.id === key);
    if (byId) return byId;
    const lower = key.toLowerCase();
    const matches = projects.filter((p) => p.name.toLowerCase() === lower);
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new Error(`Multiple projects named "${key}". Use an id: ${matches.map((p) => p.id).join(", ")}`);
    }
    const partial = projects.filter((p) => p.name.toLowerCase().includes(lower));
    if (partial.length === 1) return partial[0]!;
    throw new Error(
      `No project "${key}". Available: ${projects.map((p) => p.name).join(", ") || "(none — create one in Atelier first)"}`,
    );
  }
}
