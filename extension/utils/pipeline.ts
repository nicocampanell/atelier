// Adapted from Pond (MIT) apps/extension/entrypoints/background/capture.ts @ deb305e
// Capture pipeline: sending -> saved -> ready, with truthful states. "saved" means the server
// durably accepted the request; it is never reported as "ready" until Save.status says so.
import type { Project, Save, SaveCreated } from "../../lib/types";
import type {
  CaptureMessage,
  CaptureOrigin,
  CaptureReply,
  CaptureRequest,
  CaptureState,
  ExtensionSettings,
} from "../lib/contracts";
import { apiFetch, type ApiError, type Envelope } from "./api";
import { getSettings } from "./settings";
import { captureTab } from "./screenshot";

export const DEDUPE_WINDOW_MS = 10_000;
export const POLL_FIRST_MS = 750;
export const POLL_MAX_MS = 30_000;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export const timing = {
  sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  now: () => Date.now(),
};

export interface CaptureContext {
  tabId?: number;
  windowId?: number;
}
export type Emit = (state: CaptureState, ctx: CaptureContext) => void;

interface Pending {
  captureId: string;
  idempotencyKey: string;
  request: CaptureRequest;
  origin: CaptureOrigin;
  ctx: CaptureContext;
  /** Screenshot bytes are kept so Retry resends the same pixels. */
  blob?: Blob;
}

const recent = new Map<string, number>();
const pending = new Map<string, Pending>();

export function resetPipelineForTests() {
  recent.clear();
  pending.clear();
  projectCache = null;
}

let projectCache: { at: number; key: string; projects: Project[] } | null = null;
async function projectNameFor(settings: ExtensionSettings): Promise<string | null> {
  if (!settings.projectId) return null;
  const key = settings.serverUrl;
  if (!projectCache || projectCache.key !== key || timing.now() - projectCache.at > 30_000 ||
      !projectCache.projects.some((p) => p.id === settings.projectId)) {
    const res = await apiFetch<{ projects: Project[] }>(settings, "/api/projects");
    if (!res.ok || !Array.isArray(res.data?.projects)) return null;
    projectCache = { at: timing.now(), key, projects: res.data.projects };
  }
  return projectCache?.projects.find((p) => p.id === settings.projectId)?.name ?? null;
}

function newId(): string {
  return crypto.randomUUID();
}

/** Returns null when the capture was dropped (hook disabled, or a duplicate dedupeKey). */
export async function startCapture(
  msg: CaptureMessage,
  ctx: CaptureContext,
  emit: Emit,
): Promise<{ reply: CaptureReply; done: Promise<void> } | null> {
  const settings = await getSettings();
  if (msg.origin.type === "hook" && settings.hooks[msg.origin.source] === false) return null;
  const now = timing.now();
  if (msg.dedupeKey) {
    for (const [k, t] of recent) if (now - t > DEDUPE_WINDOW_MS) recent.delete(k);
    if (recent.has(msg.dedupeKey)) return null;
    recent.set(msg.dedupeKey, now);
  }
  const captureId = newId();
  if (!settings.token) {
    return { reply: { state: "signed-out", captureId }, done: Promise.resolve() };
  }
  const seed = msg.dedupeKey ? msg.dedupeKey.slice(0, 120) + ":" : "";
  const p: Pending = {
    captureId,
    idempotencyKey: seed + newId(),
    request: msg.request,
    origin: msg.origin,
    ctx,
  };
  pending.set(captureId, p);
  return { reply: { state: "sending", captureId }, done: run(p, emit) };
}

/** Re-runs a failed capture with the SAME Idempotency-Key, so a request that actually landed is not duplicated. */
export async function retryCapture(captureId: string, emit: Emit): Promise<{ done: Promise<void> } | null> {
  const p = pending.get(captureId);
  if (!p) return null;
  emit({ state: "sending", captureId }, p.ctx);
  return { done: run(p, emit) };
}

function fail(p: Pending, emit: Emit, error: Pick<ApiError, "message" | "retry">) {
  emit({ state: "failed", captureId: p.captureId, message: error.message, retry: error.retry }, p.ctx);
}

async function post(settings: ExtensionSettings, p: Pending, json?: unknown, form?: FormData) {
  return apiFetch<SaveCreated>(settings, "/api/saves", {
    method: "POST",
    json,
    form,
    idempotencyKey: p.idempotencyKey,
  });
}

function pageJson(settings: ExtensionSettings, url: string, title?: string, note?: string) {
  return { url, ...(title ? { title } : {}), ...(note ? { note } : {}), ...(settings.projectId ? { projectId: settings.projectId } : {}) };
}

function uploadForm(settings: ExtensionSettings, blob: Blob, filename: string, sourceUrl: string, title?: string) {
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("sourceUrl", sourceUrl);
  if (title) form.append("title", title);
  if (settings.projectId) form.append("projectId", settings.projectId);
  return form;
}

function extFor(type: string): string {
  const sub = type.split("/")[1]?.split(";")[0] ?? "bin";
  return sub === "jpeg" ? "jpg" : sub.replace(/[^a-z0-9]/gi, "") || "bin";
}

async function fetchImage(url: string): Promise<Blob | null> {
  try {
    // A request to the image host: no Atelier cookies or credentials.
    const res = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size === 0 || blob.size > MAX_IMAGE_BYTES) return null;
    return blob;
  } catch {
    return null;
  }
}

async function send(settings: ExtensionSettings, p: Pending): Promise<Envelope<SaveCreated> | { fail: string }> {
  const r = p.request;
  if (r.kind === "page") return post(settings, p, pageJson(settings, r.url, r.title, r.note));
  if (r.kind === "image") {
    const blob = p.blob ?? (await fetchImage(r.imageUrl));
    if (blob) {
      p.blob = blob;
      return post(settings, p, undefined, uploadForm(settings, blob, `image.${extFor(blob.type)}`, r.imageUrl, r.title));
    }
    // Bytes unreachable (CORS, hotlink protection): keep the link instead.
    return post(settings, p, pageJson(settings, r.imageUrl, r.title));
  }
  if (!p.blob) {
    if (p.ctx.tabId === undefined || p.ctx.windowId === undefined) return { fail: "No tab to capture." };
    try {
      p.blob = await captureTab(p.ctx.tabId, p.ctx.windowId, r.rect);
    } catch (e) {
      return { fail: e instanceof Error ? e.message : "Couldn't capture this tab." };
    }
  }
  return post(settings, p, undefined, uploadForm(settings, p.blob, "screenshot.png", r.pageUrl, r.title));
}

async function run(p: Pending, emit: Emit): Promise<void> {
  const settings = await getSettings();
  if (!settings.token) {
    emit({ state: "signed-out", captureId: p.captureId }, p.ctx);
    return;
  }
  const res = await send(settings, p);
  if ("fail" in res) return fail(p, emit, { message: res.fail, retry: false });
  if (!res.ok) return fail(p, emit, res.error);
  const save = res.data;
  const projectName = save.placedIn ? await projectNameFor(settings) : null;
  if (save.duplicateOf) {
    emit({ state: "duplicate", captureId: p.captureId, saveId: save.id, projectName }, p.ctx);
    pending.delete(p.captureId);
    return;
  }
  if (!(await settleFrom(p, save, projectName, settings, emit))) return;
  pending.delete(p.captureId);
}

/** Emits saved, then polls until ready/failed or ~30 s; after that it stays "saved" (never claims ready). */
async function settleFrom(
  p: Pending,
  first: Save,
  projectName: string | null,
  settings: ExtensionSettings,
  emit: Emit,
): Promise<boolean> {
  const done = (s: Save): boolean => {
    if (s.status === "ready") {
      emit({ state: "ready", captureId: p.captureId, saveId: s.id, title: s.title, projectName }, p.ctx);
      return true;
    }
    if (s.status === "failed") {
      emit({ state: "failed", captureId: p.captureId, message: s.error ?? "Atelier saved it but couldn't process it.", retry: false }, p.ctx);
      return true;
    }
    return false;
  };
  if (first.status === "ready") return done(first) || true;
  emit({ state: "saved", captureId: p.captureId, saveId: first.id, projectName }, p.ctx);
  if (first.status === "failed") return done(first) || true;
  let waited = 0;
  let delay = POLL_FIRST_MS;
  while (waited < POLL_MAX_MS) {
    await timing.sleep(delay);
    waited += delay;
    delay = Math.min(Math.round(delay * 1.5), 4000);
    const res = await apiFetch<Save>(settings, `/api/saves/${first.id}`);
    if (res.ok && done(res.data)) return true;
  }
  return true; // still processing: leave the "saved" state in place
}
