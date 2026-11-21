// Background processing for saves. Status flow: accepted -> processing -> ready | failed.
// Hosted: schedule via waitUntil (vinext/CF). Local next: void the promise (or after()).
import { db, sbError } from "./db";
import { decodeBody, extractHtml, MAX_TEXT_CHARS } from "./extract";
import { SafeFetchError, safeFetch } from "./fetch-safe";
import { indexSave } from "./search/index";
import { loadSaveImage } from "./search/image";
import { visualTags } from "./search/tags";
import { titleFromUrl } from "./saves";
import type { SaveKind } from "./types";

const OVERALL_TIMEOUT_MS = 60_000;

/** Schedule save processing after the response. Safe to call twice for the same id. */
export function scheduleProcessSave(
  waitUntil: ((p: Promise<unknown>) => void) | undefined,
  userId: string,
  saveId: string,
): void {
  const p = processSave(userId, saveId).catch(() => {});
  if (waitUntil) waitUntil(p);
  else void p; // local next dev / cron / startup
}

/** Cap requeue scans so PostgREST's default ~1000-row page doesn't silently truncate. */
const REQUEUE_LIMIT = 1000;

/** Pick up saves left half-done, then tag untagged ready ones. */
export async function requeueStuck(): Promise<void> {
  // ponytail: no concurrency cap — waitUntil/cron fan-out. Cap if Workers hit subrequest limits.
  const { data: stuck, error } = await db()
    .from("save")
    .select("id, user_id")
    .is("deleted_at", null)
    .in("status", ["accepted", "processing"])
    .order("created_at", { ascending: true })
    .limit(REQUEUE_LIMIT);
  if (error) sbError(error);
  for (const row of stuck ?? []) scheduleProcessSave(undefined, row.user_id, row.id);

  if (!process.env.TYPESAFE_API_KEY?.trim()) return;
  const { data: untagged, error: uErr } = await db()
    .from("save")
    .select("id, user_id")
    .is("deleted_at", null)
    .eq("status", "ready")
    .is("tags", null)
    .order("created_at", { ascending: false })
    .limit(REQUEUE_LIMIT);
  if (uErr) sbError(uErr);
  for (const row of untagged ?? []) void retagSave(row.user_id, row.id).catch(() => {});
}

function readable(e: unknown): string {
  if (e instanceof SafeFetchError) return e.message;
  if (e instanceof Error && e.message === "TIMEOUT") return "Processing took too long. Try again later.";
  return "Something went wrong while processing this save.";
}

async function markFailed(userId: string, id: string, message: string) {
  try {
    await db()
      .from("save")
      .update({ status: "failed", error: message.slice(0, 500) })
      .eq("user_id", userId)
      .eq("id", id)
      .is("deleted_at", null)
      .in("status", ["accepted", "processing"]);
  } catch {
    /* nothing more we can do */
  }
}

export async function processSave(userId: string, saveId: string): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      doProcess(userId, saveId),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("TIMEOUT")), OVERALL_TIMEOUT_MS);
      }),
    ]);
  } catch (e) {
    if (!(e instanceof SafeFetchError)) console.error("[jobs] processing failed:", e instanceof Error ? e.message : "unknown");
    await markFailed(userId, saveId, readable(e));
  } finally {
    clearTimeout(timer);
  }
}

interface Row {
  kind: SaveKind;
  source_url: string | null;
  title: string;
  title_user: boolean;
  description: string | null;
  preview_url: string | null;
  note: string | null;
  extracted_text: string | null;
}

async function doProcess(userId: string, saveId: string): Promise<void> {
  const { data: claimed, error } = await db()
    .from("save")
    .update({ status: "processing", error: null })
    .eq("user_id", userId)
    .eq("id", saveId)
    .is("deleted_at", null)
    .in("status", ["accepted", "processing"])
    .select("kind, source_url, title, title_user, description, preview_url, note, extracted_text")
    .maybeSingle();
  if (error) sbError(error);
  const row = claimed as Row | null;
  if (!row) return; // deleted or already finished

  let title = row.title;
  let description = row.description;
  let previewUrl = row.preview_url;
  let text = row.extracted_text ?? "";

  if (row.kind === "url" && row.source_url) {
    const r = await safeFetch(row.source_url, { maxBytes: 5 * 1024 * 1024, timeoutMs: 15_000, maxRedirects: 5 });
    if (r.status >= 400) throw new SafeFetchError("network", `The site responded with an error (HTTP ${r.status}).`);
    const ct = r.contentType.split(";")[0].trim();
    const fallbackTitle = titleFromUrl(new URL(r.finalUrl));
    if (ct === "text/html" || ct === "application/xhtml+xml" || ct === "") {
      const info = extractHtml(decodeBody(r.body, r.contentType), r.finalUrl);
      if (!row.title_user) title = info.title ?? fallbackTitle;
      description = info.description;
      previewUrl = info.image;
      text = info.text;
    } else if (ct.startsWith("image/")) {
      if (!row.title_user) title = fallbackTitle;
      previewUrl = r.finalUrl;
      text = "";
    } else if (ct === "text/plain") {
      if (!row.title_user) title = fallbackTitle;
      text = decodeBody(r.body, r.contentType).slice(0, MAX_TEXT_CHARS);
    } else if (!row.title_user) {
      title = fallbackTitle;
    }
    const { error: uErr } = await db()
      .from("save")
      .update({ title, description, preview_url: previewUrl, extracted_text: text })
      .eq("user_id", userId)
      .eq("id", saveId)
      .is("deleted_at", null);
    if (uErr) sbError(uErr);
  }

  const tags = await tagsFor(userId, saveId, previewUrl);
  await indexSave(userId, saveId, { title, description, text: indexText(row, text), sourceUrl: row.source_url, kind: row.kind, tags });

  const { data: done, error: dErr } = await db()
    .from("save")
    .update({ status: "ready", error: null, tags })
    .eq("user_id", userId)
    .eq("id", saveId)
    .is("deleted_at", null)
    .eq("status", "processing")
    .select("id");
  if (dErr) sbError(dErr);
  if (!done?.length) {
    // Deleted while we were working: make sure nothing lingers in the index.
    const { removeSaveIndex } = await import("./search/index");
    await removeSaveIndex(userId, saveId).catch(() => {});
  }
}

function indexText(row: Pick<Row, "kind" | "note">, text: string): string {
  return row.note && row.kind === "url" ? `${row.note}\n${text}` : text;
}

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Visual tags for a save: [] when it has no image, null when tagging failed (retried on next startup). */
async function tagsFor(userId: string, saveId: string, previewUrl: string | null): Promise<string[] | null> {
  const { data: asset, error } = await db()
    .from("asset")
    .select("storage_path, media_type, bytes")
    .eq("user_id", userId)
    .eq("save_id", saveId)
    .limit(1)
    .maybeSingle();
  if (error) sbError(error);
  const hasImage = asset ? IMAGE_TYPES.includes(asset.media_type) : Boolean(previewUrl && /^https?:\/\//i.test(previewUrl));
  if (!hasImage) return [];
  if (!process.env.TYPESAFE_API_KEY?.trim()) return null;
  const image = await loadSaveImage(
    userId,
    { storagePath: asset?.storage_path ?? null, mediaType: asset?.media_type ?? null, bytes: asset?.bytes ?? null, previewUrl },
    10_000,
  );
  return image ? visualTags(image) : null;
}

/** Tag a ready save that has no tags yet and re-index it with them. */
async function retagSave(userId: string, saveId: string): Promise<void> {
  const { data: row, error } = await db()
    .from("save")
    .select("kind, source_url, title, title_user, description, preview_url, note, extracted_text")
    .eq("user_id", userId)
    .eq("id", saveId)
    .is("deleted_at", null)
    .eq("status", "ready")
    .is("tags", null)
    .maybeSingle();
  if (error) sbError(error);
  if (!row) return;
  const r = row as Row;
  const tags = await tagsFor(userId, saveId, r.preview_url);
  if (!tags) return;
  await indexSave(userId, saveId, {
    title: r.title, description: r.description, text: indexText(r, r.extracted_text ?? ""),
    sourceUrl: r.source_url, kind: r.kind, tags,
  });
  const { error: uErr } = await db()
    .from("save")
    .update({ tags })
    .eq("user_id", userId)
    .eq("id", saveId)
    .is("deleted_at", null);
  if (uErr) sbError(uErr);
}
